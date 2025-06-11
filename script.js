// Supabase Configuration
const SUPABASE_URL = 'https://sfugtyqygjfdksmpcqhq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmdWd0eXF5Z2pmZGtzbXBjcWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc5NTIzMDgsImV4cCI6MjA2MzUyODMwOH0.G7SrGAbd1t3mioHsXHuyHYJdHwRwrVYp1AbshRwJ6l8';
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ตัวแปรสำหรับเก็บโครงสร้างหมวดหมู่
let categories = {
    // โครงสร้าง: { "mainCategory": { "subCategory1": ["subCategory2"] } }
};

// ตัวแปรสำหรับเก็บคำถาม
let questions = [];

// ตัวแปรสำหรับเล่นเกม
let currentQuestionIndex = 0;
let userAnswers = {};
let randomQuestionOrder = [];
let choiceOrderMap = {}; // ใช้เก็บลำดับตัวเลือกที่สลับแล้วของแต่ละคำถาม

// เพิ่มตัวแปร global สำหรับเก็บคำถามที่กรองแล้ว
let currentGameQuestions = [];

// ตัวแปรสำหรับเก็บข้อมูลผู้เล่น
let currentPlayer = null;

// ตัวแปรสำหรับระบบแอดมินใหม่
let currentUser = null;
let isAdminMode = false;
let adminProfile = null;

// ฟังก์ชันตรวจสอบว่าเป็นแอดมินหรือไม่
async function checkIsAdmin(userId) {
    // *** การป้องกันใหม่: ถ้ามีผู้เล่นธรรมดาอยู่แล้ว ไม่ตรวจสอบ admin ***
    if (currentPlayer && !isAdminMode) {
        console.log("🔒 มีผู้เล่นธรรมดาอยู่แล้ว - ไม่ตรวจสอบ admin");
        console.log("Current player:", currentPlayer.name, "isAdminMode:", isAdminMode);
        return null;
    }
    
    try {
        const { data, error } = await supabaseClient
            .from('admin_users')
            .select('*')
            .eq('id', userId)
            .eq('is_active', true)
            .single();
        
        if (error) {
            console.log('ไม่ใช่แอดมิน:', error.message);
            return null;
        }
        
        return data;
    } catch (error) {
        console.error('Error checking admin:', error);
        return null;
    }
}

// ฟังก์ชันล็อกอินแอดมิน - แก้ไขใหม่
async function loginAdmin(email, password) {
    try {
        // ล็อกอินด้วย Supabase Auth
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        if (error) {
            throw error;
        }
        
        // ตรวจสอบว่าเป็นแอดมินหรือไม่
        const adminData = await checkIsAdmin(data.user.id);
        
        if (!adminData) {
            // ไม่ใช่แอดมิน ต้องออกจากระบบ
            await supabaseClient.auth.signOut();
            throw new Error('คุณไม่มีสิทธิ์เข้าใช้งานระบบแอดมิน');
        }
        
        // เป็นแอดมิน - กำหนดค่าตัวแปรระบบ
        currentUser = data.user;
        adminProfile = adminData;
        isAdminMode = true;
        
        console.log('ล็อกอินแอดมินสำเร็จ:', adminData);
        
        // เปิดโหมดแอดมิน
        activateAdminMode();
        
        return true;
        
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการล็อกอิน:', error);
        alert('เกิดข้อผิดพลาด: ' + error.message);
        return false;
    }
}

// ฟังก์ชันออกจากระบบแอดมิน
async function logoutAdmin() {
    try {
        // ใช้ฟังก์ชันล็อกเอาท์ทั้งหมด
        await forceLogoutAllSessions();
        
        console.log('ออกจากระบบแอดมินแล้ว');
        
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการออกจากระบบ:', error);
    }
}

// ตัวแปรระบบสำหรับประวัติการเล่น
let gameHistory = [];
let currentHistoryPage = 1;
let historyItemsPerPage = 10;
let filteredHistory = [];

// ฟังก์ชันเพิ่มประวัติการเล่นใหม่ (ใช้ Database)
async function addGameHistoryEntry(player, score, totalQuestions, category, percentage) {
    try {
        const historyData = {
            player_name: player ? player.name : 'ไม่ระบุชื่อ',
            score: score || 0,
            total_questions: totalQuestions || 0,
            percentage: percentage || 0,
            category: JSON.stringify(category || {}),
            game_data: JSON.stringify({
                questions: currentGameQuestions ? [...currentGameQuestions] : [],
                userAnswers: userAnswers ? {...userAnswers} : {},
                randomOrder: randomQuestionOrder ? [...randomQuestionOrder] : [],
                choiceOrder: choiceOrderMap ? {...choiceOrderMap} : {}
            })
        };

        const { data, error } = await supabaseClient
            .from('game_history')
            .insert([historyData])
            .select();

        if (error) {
            console.error('เกิดข้อผิดพลาดในการบันทึกประวัติ:', error);
            return false;
        }

        console.log('บันทึกประวัติการเล่นสำเร็จ:', data);
        
        // โหลดประวัติใหม่และอัพเดตการแสดงผล
        await loadGameHistory();
        
        // อัพเดตการแสดงผลถ้าเปิดหน้าประวัติอยู่
        const historyTab = document.getElementById('history-tab');
        if (historyTab && historyTab.classList.contains('active')) {
            currentHistoryPage = 1;
            displayGameHistory();
        }
        
        return true;
    } catch (error) {
        console.error('เกิดข้อผิดพลาดที่ไม่คาดคิด:', error);
        return false;
    }
}

// ฟังก์ชันแปลงวันที่เป็นรูปแบบที่อ่านง่าย
function formatDate(date) {
    // เพิ่ม padding ให้กับตัวเลข
    const pad = (num) => String(num).padStart(2, '0');
    
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    
    return `${day}/${month}/${year} ${hours}:${minutes}`;
}

// แก้ไขฟังก์ชัน displayGameHistory()
function displayGameHistory() {
    console.log("กำลังแสดงประวัติการเล่น...");
    
    const historyContainer = document.getElementById('history-container');
    
    if (!historyContainer) {
        console.error("ไม่พบ element 'history-container'");
        return false;
    }
    
    // ตรวจสอบตัวแปรระบบที่จำเป็น
    if (!Array.isArray(filteredHistory)) {
        console.error("filteredHistory ไม่ใช่อาเรย์");
        filteredHistory = Array.isArray(gameHistory) ? [...gameHistory] : [];
    }
    
    // แสดงจำนวนรายการประวัติการเล่นที่กรองแล้ว
    const totalHistoryCount = document.getElementById('total-history-count');
    if (totalHistoryCount) {
        // แสดงจำนวนรายการที่ผ่านการกรองแล้ว - เพิ่มช่องว่าง
        totalHistoryCount.textContent = ` ${filteredHistory.length}`;
    }
    
    // ถ้าไม่มีประวัติ
    if (filteredHistory.length === 0) {
        historyContainer.innerHTML = `
            <div class="empty-state">
                <p>ไม่พบประวัติการเล่นตามเงื่อนไขที่ค้นหา</p>
                <p>ลองเปลี่ยนตัวกรองหรือรีเซ็ตการค้นหา</p>
            </div>
        `;
        
        // ซ่อนส่วนเพจเนชั่น
        const paginationElement = document.getElementById('history-pagination');
        const perPageElement = document.getElementById('history-items-per-page');
        
        if (paginationElement) paginationElement.style.display = 'none';
        if (perPageElement) perPageElement.style.display = 'none';
        
        return true;
    }
    
    // คำนวณรายการที่จะแสดงในหน้าปัจจุบัน
    if (typeof currentHistoryPage !== 'number' || isNaN(currentHistoryPage) || currentHistoryPage < 1) {
        currentHistoryPage = 1;
    }
    
    if (typeof historyItemsPerPage !== 'number' || isNaN(historyItemsPerPage) || historyItemsPerPage < 1) {
        historyItemsPerPage = 10;
    }
    
    const totalPages = Math.ceil(filteredHistory.length / historyItemsPerPage);
    if (currentHistoryPage > totalPages) {
        currentHistoryPage = totalPages;
    }
    
    const startIndex = (currentHistoryPage - 1) * historyItemsPerPage;
    const endIndex = Math.min(startIndex + historyItemsPerPage, filteredHistory.length);
    const currentPageItems = filteredHistory.slice(startIndex, endIndex);
    
    // สร้าง HTML สำหรับตาราง
    let historyHTML = `
        <div class="history-table-container">
            <table class="history-table">
                <thead>
                    <tr>
                        <th>ลำดับ</th>
                        <th>ชื่อผู้เล่น</th>
                        <th>คะแนน</th>
                        <th>หมวดหมู่</th>
                        <th>วันที่และเวลา</th>
                        ${isAdminMode ? '<th>การจัดการ</th>' : ''}
                    </tr>
                </thead>
                <tbody>
    `;
    
    // เพิ่มแถวข้อมูล
    currentPageItems.forEach((entry, index) => {
        try {
            // แปลงเวลาให้เป็นรูปแบบที่อ่านง่าย (24 ชั่วโมง)
            const dateTimeFormatted = formatDateTime24Hour(entry.playedAt);
            const formattedDate = dateTimeFormatted.date;
            const formattedTime = dateTimeFormatted.time;
            
            // แยกชื่อหมวดหมู่และทำให้ดูดีขึ้น
            let categoryHTML = '<div class="category-path">';
            
            if (entry.category) {
                const main = entry.category.main || 'ไม่ระบุ';
                const sub1 = entry.category.sub1 || 'ไม่ระบุ';
                const sub2 = entry.category.sub2 || 'ไม่ระบุ';
                
                categoryHTML += `<span class="category-segment">${main}</span>`;
                categoryHTML += `<span class="category-segment">${sub1}</span>`;
                categoryHTML += `<span class="category-segment">${sub2}</span>`;
            } else {
                categoryHTML += '<span class="category-segment">ไม่ระบุหมวดหมู่</span>';
            }
            
            categoryHTML += '</div>';
            
            // ทำให้การแสดงคะแนนดูดีขึ้น
            const scoreHTML = `
                <div class="score-display">
                    ${entry.score || 0}/${entry.totalQuestions || 0}
                    <small>(${entry.percentage || 0}%)</small>
                </div>
            `;
            
            // คำนวณเลขลำดับตามหน้าปัจจุบัน
            const itemNumber = startIndex + index + 1;
            
            // สร้าง HTML สำหรับวันที่และเวลา
            const dateTimeHTML = `
                <div class="date-time">
                    <span class="date-display">${formattedDate}</span>
                    <span class="time-display">${formattedTime}</span>
                </div>
            `;
            
            // สร้าง HTML สำหรับคอลัมน์การจัดการ (เฉพาะแอดมิน)
            const managementHTML = isAdminMode ? `
                <td class="action-cell">
                    <button class="delete-history-btn small-btn" onclick="confirmDeleteHistory('${entry.id}')">ลบ</button>
                </td>
            ` : '';
            
            historyHTML += `
                <tr data-id="${entry.id}" class="history-row clickable-row" onclick="showGameDetails('${entry.id}')">
                    <td>${itemNumber}</td>
                    <td><div class="player-name" title="${entry.playerName || 'ไม่ระบุชื่อ'}">${entry.playerName || 'ไม่ระบุชื่อ'}</div></td>
                    <td>${scoreHTML}</td>
                    <td>${categoryHTML}</td>
                    <td>${dateTimeHTML}</td>
                    ${managementHTML}
                </tr>
            `;
        } catch (error) {
            console.error("เกิดข้อผิดพลาดในการแสดงประวัติรายการที่", index, error);
            const managementHTML = isAdminMode ? '<td>เกิดข้อผิดพลาด</td>' : '';
            historyHTML += `
                <tr>
                    <td colspan="${isAdminMode ? 6 : 5}">เกิดข้อผิดพลาดในการแสดงประวัติรายการนี้</td>
                </tr>
            `;
        }
    });
    
    historyHTML += `
                </tbody>
            </table>
        </div>
    `;
    
    // แสดงผล
    historyContainer.innerHTML = historyHTML;
    
    // อัพเดตเพจเนชั่น
    updateHistoryPagination();
    
    // แสดงส่วนเพจเนชั่นและตัวเลือกจำนวนรายการ
    const paginationElement = document.getElementById('history-pagination');
    const perPageElement = document.getElementById('history-items-per-page');
    
    if (paginationElement) paginationElement.style.display = 'flex';
    if (perPageElement) perPageElement.style.display = 'flex';
    
    console.log("แสดงประวัติการเล่นเรียบร้อยแล้ว:", currentPageItems.length, "รายการ", isAdminMode ? "(โหมดแอดมิน)" : "(โหมดผู้เล่น)");
    return true;
}

// ฟังก์ชันอัพเดต pagination
function updateHistoryPagination() {
    const paginationContainer = document.getElementById('history-pagination');
    const totalPages = Math.ceil(filteredHistory.length / historyItemsPerPage);
    
    // ไม่มีข้อมูลหรือมีข้อมูลน้อยกว่า 1 หน้า
    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    let paginationHTML = '';
    
    // ปุ่มก่อนหน้า
    paginationHTML += `
        <button class="history-page-btn ${currentHistoryPage === 1 ? 'disabled' : ''}" 
                onclick="goToHistoryPage(${currentHistoryPage - 1})" 
                ${currentHistoryPage === 1 ? 'disabled' : ''}>
            &laquo;
        </button>
    `;
    
    // จำนวนปุ่มที่แสดง
    let startPage = Math.max(1, currentHistoryPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    // ปรับจำนวนปุ่มให้แสดงครบ 5 ปุ่ม (ถ้ามีมากพอ)
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }
    
    // สร้างปุ่มตัวเลข
    for (let i = startPage; i <= endPage; i++) {
        paginationHTML += `
            <button class="history-page-btn ${i === currentHistoryPage ? 'active' : ''}" 
                    onclick="goToHistoryPage(${i})">
                ${i}
            </button>
        `;
    }
    
    // ปุ่มถัดไป
    paginationHTML += `
        <button class="history-page-btn ${currentHistoryPage === totalPages ? 'disabled' : ''}" 
                onclick="goToHistoryPage(${currentHistoryPage + 1})" 
                ${currentHistoryPage === totalPages ? 'disabled' : ''}>
            &raquo;
        </button>
    `;
    
    paginationContainer.innerHTML = paginationHTML;
}

// ฟังก์ชันเปลี่ยนหน้า
function goToHistoryPage(page) {
    if (page < 1 || page > Math.ceil(filteredHistory.length / historyItemsPerPage)) {
        return;
    }
    
    currentHistoryPage = page;
    displayGameHistory();
}

// แก้ไขฟังก์ชัน filterGameHistory()
function filterGameHistory() {
    // ดึงค่าจากฟอร์ม
    const dateFrom = document.getElementById('filter-date-from').value;
    const dateTo = document.getElementById('filter-date-to').value;
    const playerName = document.getElementById('filter-player-name').value.trim().toLowerCase();
    const mainCategory = document.getElementById('filter-history-main-category').value;
    const sub1Category = document.getElementById('filter-history-sub1-category').value;
    const sub2Category = document.getElementById('filter-history-sub2-category').value;
    
    // เริ่มจากประวัติทั้งหมด
    filteredHistory = [...gameHistory];
    
    // กรองตามวันที่เริ่มต้น
    if (dateFrom) {
        const fromDate = new Date(dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        filteredHistory = filteredHistory.filter(entry => {
            const playedDate = new Date(entry.playedAt);
            return playedDate >= fromDate;
        });
    }
    
    // กรองตามวันที่สิ้นสุด
    if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        filteredHistory = filteredHistory.filter(entry => {
            const playedDate = new Date(entry.playedAt);
            return playedDate <= toDate;
        });
    }
    
    // กรองตามชื่อผู้เล่น
    if (playerName) {
        filteredHistory = filteredHistory.filter(entry => 
            entry.playerName && entry.playerName.toLowerCase().includes(playerName)
        );
    }
    
    // กรองตามหมวดหมู่หลัก
    if (mainCategory) {
        filteredHistory = filteredHistory.filter(entry => 
            entry.category && entry.category.main === mainCategory
        );
        
        // กรองตามหมวดหมู่ย่อย 1
        if (sub1Category) {
            filteredHistory = filteredHistory.filter(entry => 
                entry.category && entry.category.sub1 === sub1Category
            );
            
            // กรองตามหมวดหมู่ย่อย 2
            if (sub2Category) {
                filteredHistory = filteredHistory.filter(entry => 
                    entry.category && entry.category.sub2 === sub2Category
                );
            }
        }
    }
    
    // รีเซ็ตหน้าปัจจุบัน
    currentHistoryPage = 1;
    
    // แสดงผลใหม่
    displayGameHistory();
}

// ฟังก์ชันอัพเดตตัวเลือกหมวดหมู่ในตัวกรอง
function updateHistoryCategoryFilter() {
    const categorySelect = document.getElementById('filter-history-category');
    if (!categorySelect) return;
    
    // เก็บตัวเลือกแรกไว้
    const firstOption = categorySelect.options[0];
    categorySelect.innerHTML = '';
    categorySelect.appendChild(firstOption);
    
    // รวบรวมหมวดหมู่ที่มีในประวัติ
    const uniqueCategories = new Set();
    gameHistory.forEach(entry => {
        if (entry.category && entry.category.main) {
            uniqueCategories.add(entry.category.main);
        }
    });
    
    // เพิ่มหมวดหมู่ทั้งหมดในรายการ
    for (const mainCategory in categories) {
        // เพิ่มเฉพาะหมวดหมู่ที่มีในประวัติ
        if (uniqueCategories.has(mainCategory)) {
            const option = document.createElement('option');
            option.value = mainCategory;
            option.textContent = mainCategory;
            categorySelect.appendChild(option);
        }
    }
}

// ฟังก์ชันเริ่มต้นระบบประวัติการเล่น - แก้ไขไม่ให้โหลดซ้ำ
function initHistorySystem() {
    console.log("กำลังเริ่มต้นระบบประวัติการเล่น...");
    
    // ตรวจสอบตัวแปรเริ่มต้น
    if (typeof currentHistoryPage !== 'number' || isNaN(currentHistoryPage)) {
        currentHistoryPage = 1;
    }
    
    if (typeof historyItemsPerPage !== 'number' || isNaN(historyItemsPerPage)) {
        historyItemsPerPage = 10;
    }
    
    // ใช้ข้อมูลที่โหลดมาจาก Database ใน initializeApp()
    if (!Array.isArray(gameHistory)) {
        console.warn("gameHistory ไม่ใช่ array หรือยังไม่โหลด กำลังสร้างใหม่");
        gameHistory = [];
    }
    
    if (!Array.isArray(filteredHistory)) {
        console.log("สร้าง filteredHistory จาก gameHistory ที่โหลดแล้ว");
        filteredHistory = [...gameHistory];
    }
    
    console.log("ใช้ประวัติที่โหลดแล้ว:", gameHistory.length, "รายการ");
    
    // ตรวจสอบและปรับปรุงส่วนตัวกรองในหน้าประวัติ
    updateHistoryFilterSection();
    
    // อัพเดตตัวกรองหมวดหมู่จากโครงสร้างหมวดหมู่ที่มีอยู่
    updateHistoryCategoryFilters();
        
    // ตั้งค่า event listeners สำหรับปุ่มต่างๆ
    setupHistoryEventListeners();
    
    // แสดงประวัติ
    try {
        displayGameHistory();
        
        // ตั้งค่าเริ่มต้นจำนวนรายการทั้งหมด
        const totalHistoryCount = document.getElementById('total-history-count');
        if (totalHistoryCount) {
            totalHistoryCount.textContent = ` ${filteredHistory.length}`;
        }
        
        console.log("แสดงประวัติการเล่นครั้งแรกเรียบร้อยแล้ว");
    } catch (error) {
        console.error("เกิดข้อผิดพลาดในการแสดงประวัติการเล่น:", error);
    }
    
    console.log("ระบบประวัติการเล่นพร้อมใช้งานแล้ว");
    return true;
}

// แทนที่ฟังก์ชัน deleteHistoryEntry ทั้งหมด
async function deleteHistoryEntry(id) {
    // ตรวจสอบว่าประวัติการเล่นมีหรือไม่
    if (!Array.isArray(gameHistory) || gameHistory.length === 0) {
        console.error("ไม่มีประวัติการเล่นในระบบ");
        return false;
    }
    
    // หาข้อมูลประวัติที่จะลบ
    const historyToDelete = gameHistory.find(entry => entry.id === id);
    if (!historyToDelete) {
        console.error("ไม่พบประวัติการเล่นที่ต้องการลบ");
        alert("ไม่พบประวัติการเล่นที่ต้องการลบ");
        return false;
    }
    
    try {
        // ลบจาก Supabase Database
        const { error } = await supabaseClient
            .from('game_history')
            .delete()
            .eq('id', id);
        
        if (error) {
            console.error('เกิดข้อผิดพลาดในการลบประวัติจาก Database:', error);
            alert('เกิดข้อผิดพลาดในการลบประวัติ: ' + error.message);
            return false;
        }
        
        console.log('ลบประวัติจาก Database สำเร็จ ID:', id);
        
        // ลบออกจาก gameHistory (ในหน่วยความจำ)
        gameHistory = gameHistory.filter(entry => entry.id !== id);
        
        // ลบออกจาก filteredHistory ด้วย
        filteredHistory = filteredHistory.filter(entry => entry.id !== id);
        
        // บันทึกการเปลี่ยนแปลงลง localStorage (สำหรับ sync)
        localStorage.setItem('quiz-game-history', JSON.stringify(gameHistory));
        
        // อัพเดตการแสดงผล
        currentHistoryPage = 1; // รีเซ็ตไปที่หน้าแรก
        displayGameHistory();
        
        console.log("ลบประวัติการเล่นเรียบร้อยแล้ว");
        return true;
        
    } catch (error) {
        console.error('เกิดข้อผิดพลาดที่ไม่คาดคิด:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล');
        return false;
    }
}

// แทนที่ฟังก์ชัน clearAllHistory ทั้งหมด
async function clearAllHistory() {
    // ตรวจสอบว่ามีประวัติการเล่นหรือไม่
    if (!Array.isArray(gameHistory) || gameHistory.length === 0) {
        alert("ไม่มีประวัติการเล่นในระบบ");
        return false;
    }
    
    try {
        // ลบประวัติทั้งหมดจาก Supabase Database
        const { error } = await supabaseClient
            .from('game_history')
            .delete()
            .neq('id', 0); // ลบทั้งหมด (neq คือ not equal, ใช้เงื่อนไขที่เป็นจริงเสมอ)
        
        if (error) {
            console.error('เกิดข้อผิดพลาดในการลบประวัติทั้งหมดจาก Database:', error);
            alert('เกิดข้อผิดพลาดในการลบประวัติทั้งหมด: ' + error.message);
            return false;
        }
        
        console.log('ลบประวัติทั้งหมดจาก Database สำเร็จ');
        
        // รีเซ็ตตัวแปรระบบ
        gameHistory = [];
        filteredHistory = [];
        currentHistoryPage = 1;
        
        // บันทึกการเปลี่ยนแปลงลง localStorage
        localStorage.setItem('quiz-game-history', JSON.stringify(gameHistory));
        
        // อัพเดตการแสดงผล
        displayGameHistory();
        
        console.log("ลบประวัติการเล่นทั้งหมดเรียบร้อยแล้ว");
        return true;
        
    } catch (error) {
        console.error('เกิดข้อผิดพลาดที่ไม่คาดคิดในการลบประวัติทั้งหมด:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล');
        return false;
    }
}

// แทนที่ฟังก์ชัน confirmDeleteHistory ทั้งหมด - เพิ่ม confirmation ที่ชัดเจนขึ้น
function confirmDeleteHistory(id) {
    // ป้องกันการกระจายของ event
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    // ตรวจสอบว่ามี id หรือไม่
    if (!id) {
        console.error("ไม่มี id สำหรับลบประวัติการเล่น");
        return false;
    }
    
    // ค้นหาข้อมูลของประวัติที่จะลบ
    const historyToDelete = filteredHistory.find(entry => entry.id === id);
    if (!historyToDelete) {
        console.error("ไม่พบประวัติการเล่นที่ต้องการลบ");
        return false;
    }
    
    // สร้างและแสดงหน้าต่างยืนยัน
    const confirmDialog = document.createElement('div');
    confirmDialog.className = 'confirm-dialog-overlay';
    confirmDialog.innerHTML = `
        <div class="confirm-dialog">
            <div class="confirm-header">
                <h3>⚠️ ยืนยันการลบประวัติ</h3>
                <button class="close-btn" onclick="closeConfirmDialog()">&times;</button>
            </div>
            <div class="confirm-body">
                <p><strong>คุณต้องการลบประวัติการเล่นนี้ใช่หรือไม่?</strong></p>
                <div style="margin: 15px 0; padding: 10px; background-color: #f0f7ff; border-radius: 6px; border-left: 4px solid #1976d2;">
                    <p><strong>ผู้เล่น:</strong> ${historyToDelete.playerName}</p>
                    <p><strong>คะแนน:</strong> ${historyToDelete.score}/${historyToDelete.totalQuestions} (${historyToDelete.percentage}%)</p>
                    <p><strong>วันที่:</strong> ${formatDateTime24Hour(historyToDelete.playedAt).full}</p>
                </div>
                <p style="color: #f44336; font-weight: 600;">⚠️ การลบนี้จะลบข้อมูลออกจากฐานข้อมูลถาวร และไม่สามารถเรียกคืนได้</p>
            </div>
            <div class="confirm-actions">
                <button class="confirm-delete-btn" onclick="performDeleteHistory('${id}')">🗑️ ยืนยันการลบ</button>
                <button class="cancel-btn" onclick="closeConfirmDialog()">❌ ยกเลิก</button>
            </div>
        </div>
    `;
    
    // เพิ่มหน้าต่างยืนยันเข้าไปใน DOM
    document.body.appendChild(confirmDialog);
    
    return true;
}

// แทนที่ฟังก์ชัน confirmClearAllHistory ทั้งหมด - เพิ่ม confirmation ที่รุนแรงขึ้น
function confirmClearAllHistory() {
    // ป้องกันการกระจายของ event
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    // ตรวจสอบว่ามีประวัติการเล่นหรือไม่
    if (!Array.isArray(gameHistory) || gameHistory.length === 0) {
        alert("ไม่มีประวัติการเล่นในระบบ");
        return false;
    }
    
    // สร้างและแสดงหน้าต่างยืนยัน
    const confirmDialog = document.createElement('div');
    confirmDialog.className = 'confirm-dialog-overlay';
    confirmDialog.innerHTML = `
        <div class="confirm-dialog">
            <div class="confirm-header">
                <h3>🚨 ยืนยันการลบประวัติทั้งหมด</h3>
                <button class="close-btn" onclick="closeConfirmDialog()">&times;</button>
            </div>
            <div class="confirm-body">
                <p><strong>คุณต้องการลบประวัติการเล่นทั้งหมด ${gameHistory.length} รายการ ใช่หรือไม่?</strong></p>
                
                <div style="margin: 15px 0; padding: 15px; background-color: #fff3e0; border-radius: 6px; border-left: 4px solid #ff9800;">
                    <p><strong>📊 ข้อมูลที่จะถูกลบ:</strong></p>
                    <p>• ประวัติการเล่นทั้งหมด: ${gameHistory.length} รายการ</p>
                    <p>• ข้อมูลคะแนนและเวลาการเล่น</p>
                    <p>• รายละเอียดคำถามและคำตอบ</p>
                </div>
                
                <div style="margin: 15px 0; padding: 15px; background-color: #ffebee; border-radius: 6px; border-left: 4px solid #f44336;">
                    <p style="color: #f44336; font-weight: 600; margin: 0;">
                        🚨 <strong>คำเตือนสำคัญ:</strong> การดำเนินการนี้จะลบข้อมูลออกจากฐานข้อมูลถาวร 
                        และ<u>ไม่สามารถยกเลิกหรือเรียกคืนได้</u>
                    </p>
                </div>
                
                <div style="margin: 15px 0; padding: 10px; background-color: #f5f5f5; border-radius: 6px;">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" id="confirm-delete-checkbox" style="margin-right: 8px;">
                        <span>ฉันเข้าใจและยืนยันว่าต้องการลบประวัติทั้งหมดอย่างถาวร</span>
                    </label>
                </div>
            </div>
            <div class="confirm-actions">
                <button class="confirm-delete-btn" id="final-delete-btn" onclick="performClearAllHistory()" disabled>🗑️ ลบประวัติทั้งหมด</button>
                <button class="cancel-btn" onclick="closeConfirmDialog()">❌ ยกเลิก</button>
            </div>
        </div>
    `;
    
    // เพิ่มหน้าต่างยืนยันเข้าไปใน DOM
    document.body.appendChild(confirmDialog);
    
    // เพิ่ม event listener สำหรับ checkbox
    setTimeout(() => {
        const checkbox = document.getElementById('confirm-delete-checkbox');
        const deleteBtn = document.getElementById('final-delete-btn');
        
        if (checkbox && deleteBtn) {
            checkbox.addEventListener('change', function() {
                deleteBtn.disabled = !this.checked;
                if (this.checked) {
                    deleteBtn.style.backgroundColor = '#f44336';
                    deleteBtn.style.cursor = 'pointer';
                } else {
                    deleteBtn.style.backgroundColor = '#ccc';
                    deleteBtn.style.cursor = 'not-allowed';
                }
            });
        }
    }, 100);
    
    return true;
}

// ฟังก์ชันปิดหน้าต่างยืนยัน
function closeConfirmDialog() {
    const dialogs = document.querySelectorAll('.confirm-dialog-overlay');
    dialogs.forEach(dialog => {
        dialog.remove();
    });
}

// ฟังก์ชันใหม่สำหรับการลบจริง (แยกออกจาก confirmation)
async function performDeleteHistory(id) {
    closeConfirmDialog();
    
    // แสดง loading
    const loadingMsg = document.createElement('div');
    loadingMsg.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 20px;
        border-radius: 8px;
        z-index: 10000;
    `;
    loadingMsg.textContent = '🗑️ กำลังลบประวัติ...';
    document.body.appendChild(loadingMsg);
    
    const success = await deleteHistoryEntry(id);
    
    // ลบ loading message
    loadingMsg.remove();
    
    if (success) {
        // แสดงข้อความสำเร็จ
        const successMsg = document.createElement('div');
        successMsg.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4caf50;
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            z-index: 10000;
            font-weight: 600;
        `;
        successMsg.textContent = '✅ ลบประวัติเรียบร้อยแล้ว';
        document.body.appendChild(successMsg);
        
        setTimeout(() => {
            successMsg.remove();
        }, 3000);
    }
}

// ฟังก์ชันใหม่สำหรับการลบทั้งหมดจริง
async function performClearAllHistory() {
    closeConfirmDialog();
    
    // แสดง loading
    const loadingMsg = document.createElement('div');
    loadingMsg.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 20px;
        border-radius: 8px;
        z-index: 10000;
        text-align: center;
    `;
    loadingMsg.innerHTML = '🗑️ กำลังลบประวัติทั้งหมด...<br><small>โปรดรอสักครู่</small>';
    document.body.appendChild(loadingMsg);
    
    const success = await clearAllHistory();
    
    // ลบ loading message
    loadingMsg.remove();
    
    if (success) {
        // แสดงข้อความสำเร็จ
        const successMsg = document.createElement('div');
        successMsg.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4caf50;
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            z-index: 10000;
            font-weight: 600;
        `;
        successMsg.textContent = '✅ ลบประวัติทั้งหมดเรียบร้อยแล้ว';
        document.body.appendChild(successMsg);
        
        setTimeout(() => {
            successMsg.remove();
        }, 4000);
    }
}

function updateHistoryFilterSection() {
    const filterForm = document.querySelector('.filter-form');
    if (!filterForm) return;
    
    // ปรับปรุง HTML ของส่วนตัวกรอง - แบบเรียบง่ายและดูดี
    filterForm.innerHTML = `
        <div class="filter-container">
            <!-- ส่วนกรองตามวันที่ -->
            <div class="filter-row">
                <div class="filter-group date-group">
                    <div class="filter-label">ช่วงเวลา:</div>
                    <div class="date-inputs">
                        <div class="date-field">
                            <input type="date" id="filter-date-from" class="date-input" placeholder="เริ่มต้น">
                        </div>
                        <span class="date-separator">-</span>
                        <div class="date-field">
                            <input type="date" id="filter-date-to" class="date-input" placeholder="สิ้นสุด">
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- ส่วนค้นหาชื่อผู้เล่น -->
            <div class="filter-row">
                <div class="filter-group search-group">
                    <div class="filter-label">ชื่อผู้เล่น:</div>
                    <div class="search-field">
                        <input type="text" id="filter-player-name" class="search-input" placeholder="พิมพ์ชื่อผู้เล่นที่ต้องการค้นหา">
                        <span class="search-icon">🔍</span>
                    </div>
                </div>
            </div>
            
            <!-- ส่วนกรองตามหมวดหมู่ -->
            <div class="filter-row">
                <div class="filter-group category-group">
                    <div class="filter-label">หมวดหมู่:</div>
                    <div class="category-selects">
                        <div class="select-field">
                            <select id="filter-history-main-category" class="filter-select">
                                <option value="">ทุกหมวดหมู่</option>
                            </select>
                            <span class="select-arrow"></span>
                        </div>
                        <div class="select-field">
                            <select id="filter-history-sub1-category" class="filter-select" disabled>
                                <option value="">ทุกหมวดหมู่ย่อย 1</option>
                            </select>
                            <span class="select-arrow"></span>
                        </div>
                        <div class="select-field">
                            <select id="filter-history-sub2-category" class="filter-select" disabled>
                                <option value="">ทุกหมวดหมู่ย่อย 2</option>
                            </select>
                            <span class="select-arrow"></span>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- ปุ่มใช้งาน -->
            <div class="filter-row filter-actions-row">
                <button id="apply-history-filter" class="filter-button primary-button">ค้นหา</button>
                <button id="reset-history-filter" class="filter-button secondary-button">รีเซ็ต</button>
            </div>
        </div>
    `;
    
    // อัพเดตตัวกรองหมวดหมู่
    updateHistoryCategoryFilters();
}

function updateHistoryCategoryFilters() {
    // อัพเดตหมวดหมู่หลักก่อน
    updateHistoryMainCategory();
    
    // ตั้งค่า Event Listeners สำหรับตัวเลือกหมวดหมู่
    setupCategoryFilterListeners();
}

// ฟังก์ชันอัพเดตตัวเลือกหมวดหมู่หลัก
function updateHistoryMainCategory() {
    const categorySelect = document.getElementById('filter-history-main-category');
    if (!categorySelect) return;
    
    // เก็บตัวเลือกแรกไว้
    const firstOption = categorySelect.options[0];
    categorySelect.innerHTML = '';
    categorySelect.appendChild(firstOption);
    
    // รวบรวมหมวดหมู่ที่มีในประวัติ
    const uniqueCategories = new Set();
    gameHistory.forEach(entry => {
        if (entry.category && entry.category.main) {
            uniqueCategories.add(entry.category.main);
        }
    });
    
    // เพิ่มหมวดหมู่ทั้งหมดในรายการ
    for (const mainCategory in categories) {
        // เพิ่มเฉพาะหมวดหมู่ที่มีในประวัติ
        if (uniqueCategories.has(mainCategory)) {
            const option = document.createElement('option');
            option.value = mainCategory;
            option.textContent = mainCategory;
            categorySelect.appendChild(option);
        }
    }
}

// ฟังก์ชันอัพเดตตัวเลือกหมวดหมู่ย่อย 1
function updateHistorySub1Category(mainCategory) {
    const sub1Select = document.getElementById('filter-history-sub1-category');
    if (!sub1Select) return;
    
    // ล้างตัวเลือกเดิม
    sub1Select.innerHTML = '<option value="">ทุกหมวดหมู่ย่อย 1</option>';
    
    // ถ้าไม่ได้เลือกหมวดหมู่หลัก ให้ปิดการใช้งาน
    if (!mainCategory) {
        sub1Select.disabled = true;
        return;
    }
    
    // เพิ่มหมวดหมู่ย่อย 1 จากโครงสร้างหมวดหมู่ที่มีอยู่
    if (categories[mainCategory]) {
        for (const sub1 in categories[mainCategory]) {
            const option = document.createElement('option');
            option.value = sub1;
            option.textContent = sub1;
            sub1Select.appendChild(option);
        }
    }
    
    // เปิดใช้งานตัวเลือก
    sub1Select.disabled = false;
}

// ฟังก์ชันอัพเดตตัวเลือกหมวดหมู่ย่อย 2 สำหรับตัวกรองประวัติ
function updateHistorySub2Category(mainCategory, subCategory1) {
    const sub2CategorySelect = document.getElementById('filter-history-sub2-category');
    if (!sub2CategorySelect) return;
    
    // ล้างตัวเลือกเดิม
    sub2CategorySelect.innerHTML = '<option value="">ทุกหมวดหมู่ย่อย 2</option>';
    
    // ถ้าไม่ได้เลือกหมวดหมู่หลักหรือหมวดหมู่ย่อย 1 ให้ปิดการใช้งาน
    if (!mainCategory || !subCategory1) {
        sub2CategorySelect.disabled = true;
        return;
    }
    
    // เพิ่มหมวดหมู่ย่อย 2 จากโครงสร้างหมวดหมู่ที่มีอยู่
    if (categories[mainCategory] && categories[mainCategory][subCategory1]) {
        for (const subCategory2Item of categories[mainCategory][subCategory1]) {
            const option = document.createElement('option');
            
            // ตรวจสอบว่าเป็น object หรือ string
            if (typeof subCategory2Item === 'object' && subCategory2Item.name) {
                // กรณีที่เป็น object ใหม่
                option.value = subCategory2Item.name;
                option.textContent = subCategory2Item.name;
            } else {
                // กรณีที่เป็น string เก่า (backward compatibility)
                option.value = subCategory2Item;
                option.textContent = subCategory2Item;
            }
            
            sub2CategorySelect.appendChild(option);
        }
    }
    
    // เปิดใช้งานตัวเลือก
    sub2CategorySelect.disabled = false;
}

// ฟังก์ชันตั้งค่า Event Listeners สำหรับตัวเลือกหมวดหมู่
function setupCategoryFilterListeners() {
    const mainCategorySelect = document.getElementById('filter-history-main-category');
    const sub1CategorySelect = document.getElementById('filter-history-sub1-category');
    const sub2CategorySelect = document.getElementById('filter-history-sub2-category');
    
    if (mainCategorySelect) {
        // ลบ event listener เดิม (ถ้ามี)
        const newMainCategorySelect = mainCategorySelect.cloneNode(true);
        if (mainCategorySelect.parentNode) {
            mainCategorySelect.parentNode.replaceChild(newMainCategorySelect, mainCategorySelect);
        }
        
        // เพิ่ม event listener ใหม่
        newMainCategorySelect.addEventListener('change', function() {
            const mainCategory = this.value;
            
            // อัพเดตหมวดหมู่ย่อย 1
            updateHistorySub1Category(mainCategory);
            
            // รีเซ็ตหมวดหมู่ย่อย 2
            if (sub2CategorySelect) {
                sub2CategorySelect.innerHTML = '<option value="">ทุกหมวดหมู่ย่อย 2</option>';
                sub2CategorySelect.disabled = true;
            }
            
            // ใช้ตัวกรองใหม่ทันที
            filterGameHistory();
        });
    }
    
    if (sub1CategorySelect) {
        // ลบ event listener เดิม (ถ้ามี)
        const newSub1CategorySelect = sub1CategorySelect.cloneNode(true);
        if (sub1CategorySelect.parentNode) {
            sub1CategorySelect.parentNode.replaceChild(newSub1CategorySelect, sub1CategorySelect);
        }
        
        // เพิ่ม event listener ใหม่
        newSub1CategorySelect.addEventListener('change', function() {
            const mainCategory = document.getElementById('filter-history-main-category').value;
            const sub1Category = this.value;
            
            // อัพเดตหมวดหมู่ย่อย 2
            updateHistorySub2Category(mainCategory, sub1Category);
            
            // ใช้ตัวกรองใหม่ทันที
            filterGameHistory();
        });
    }
    
    if (sub2CategorySelect) {
        // ลบ event listener เดิม (ถ้ามี)
        const newSub2CategorySelect = sub2CategorySelect.cloneNode(true);
        if (sub2CategorySelect.parentNode) {
            sub2CategorySelect.parentNode.replaceChild(newSub2CategorySelect, sub2CategorySelect);
        }
        
        // เพิ่ม event listener ใหม่
        newSub2CategorySelect.addEventListener('change', function() {
            // ใช้ตัวกรองใหม่ทันที
            filterGameHistory();
        });
    }
}

// แก้ไขฟังก์ชัน setupHistoryEventListeners เพื่อเพิ่ม event listener สำหรับการรีเซ็ตตัวกรอง
function setupHistoryEventListeners() {
    const applyFilterBtn = document.getElementById('apply-history-filter');
    if (applyFilterBtn) {
        // ลบ event listener เดิม (ถ้ามี) และเพิ่มใหม่
        const newApplyFilterBtn = applyFilterBtn.cloneNode(true);
        if (applyFilterBtn.parentNode) {
            applyFilterBtn.parentNode.replaceChild(newApplyFilterBtn, applyFilterBtn);
        }
        
        newApplyFilterBtn.addEventListener('click', function() {
            try {
                filterGameHistory();
            } catch (error) {
                console.error("เกิดข้อผิดพลาดในการกรองประวัติ:", error);
                alert("เกิดข้อผิดพลาดในการกรองประวัติ โปรดลองใหม่อีกครั้ง");
            }
        });
        console.log("ตั้งค่า event listener สำหรับปุ่มค้นหาประวัติเรียบร้อยแล้ว");
    }
    
    const resetFilterBtn = document.getElementById('reset-history-filter');
    if (resetFilterBtn) {
        // ลบ event listener เดิม (ถ้ามี) และเพิ่มใหม่
        const newResetFilterBtn = resetFilterBtn.cloneNode(true);
        if (resetFilterBtn.parentNode) {
            resetFilterBtn.parentNode.replaceChild(newResetFilterBtn, resetFilterBtn);
        }
        
        newResetFilterBtn.addEventListener('click', function() {
            try {
                // รีเซ็ตฟอร์มกรอง
                const fromDateInput = document.getElementById('filter-date-from');
                const toDateInput = document.getElementById('filter-date-to');
                const playerNameInput = document.getElementById('filter-player-name');
                const mainCategorySelect = document.getElementById('filter-history-main-category');
                const sub1CategorySelect = document.getElementById('filter-history-sub1-category');
                const sub2CategorySelect = document.getElementById('filter-history-sub2-category');
                
                if (fromDateInput) fromDateInput.value = '';
                if (toDateInput) toDateInput.value = '';
                if (playerNameInput) playerNameInput.value = '';
                if (mainCategorySelect) mainCategorySelect.value = '';
                if (sub1CategorySelect) {
                    sub1CategorySelect.value = '';
                    sub1CategorySelect.disabled = true;
                }
                if (sub2CategorySelect) {
                    sub2CategorySelect.value = '';
                    sub2CategorySelect.disabled = true;
                }
                
                // รีเซ็ตการกรอง
                filteredHistory = [...gameHistory];
                currentHistoryPage = 1;
                
                // แสดงผลใหม่
                displayGameHistory();
            } catch (error) {
                console.error("เกิดข้อผิดพลาดในการรีเซ็ตตัวกรอง:", error);
            }
        });
        console.log("ตั้งค่า event listener สำหรับปุ่มรีเซ็ตการกรองเรียบร้อยแล้ว");
    }
    
    // เพิ่ม event listener สำหรับช่องค้นหาชื่อผู้เล่น (กรองทันทีเมื่อพิมพ์)
    const playerNameInput = document.getElementById('filter-player-name');
    if (playerNameInput) {
        let searchTimeout = null;
        playerNameInput.addEventListener('input', function() {
            // ยกเลิกตัวจับเวลาเดิม (ถ้ามี)
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            
            // ตั้งตัวจับเวลาใหม่เพื่อรอให้หยุดพิมพ์ก่อนค้นหา
            searchTimeout = setTimeout(() => {
                filterGameHistory();
                searchTimeout = null;
            }, 500); // รอ 500ms หลังจากหยุดพิมพ์
        });
    }
    
    const historyPerPageSelect = document.getElementById('history-per-page');
    if (historyPerPageSelect) {
        // ลบ event listener เดิม (ถ้ามี) และเพิ่มใหม่
        const newHistoryPerPageSelect = historyPerPageSelect.cloneNode(true);
        if (historyPerPageSelect.parentNode) {
            historyPerPageSelect.parentNode.replaceChild(newHistoryPerPageSelect, historyPerPageSelect);
        }
        
        newHistoryPerPageSelect.addEventListener('change', function() {
            try {
                historyItemsPerPage = parseInt(this.value);
                if (isNaN(historyItemsPerPage) || historyItemsPerPage < 1) {
                    historyItemsPerPage = 10; // ค่าเริ่มต้นถ้าไม่ถูกต้อง
                }
                currentHistoryPage = 1;
                displayGameHistory();
            } catch (error) {
                console.error("เกิดข้อผิดพลาดในการเปลี่ยนจำนวนรายการต่อหน้า:", error);
            }
        });
        console.log("ตั้งค่า event listener สำหรับตัวเลือกจำนวนรายการต่อหน้าเรียบร้อยแล้ว");
    }
}

async function initializeApp() {
    console.log("กำลังเริ่มต้นแอปพลิเคชัน...");
    
    // 1. โหลดข้อมูลจาก Database และ localStorage
    await loadCategories();
    await loadQuestions();
    await loadGameHistory(); // เพิ่มบรรทัดนี้เพื่อโหลดประวัติการเล่น
    
    // 2. ตั้งค่า event listeners สำหรับแท็บ
    setupTabNavigation();
    
    // 3. ตั้งค่าระบบผู้เล่น (ย้ายขึ้นมาก่อน)
    initPlayerSystem();
    
    // 4. ตั้งค่าระบบหมวดหมู่แบบใหม่
    await initCategorySystemNew();
    
    // 5. ตั้งค่าระบบคำถาม
    initQuestionSystem();
    
    // 6. ตั้งค่าระบบประวัติการเล่น
    initHistorySystem();
    
    // 7. ตั้งค่าระบบเล่นเกม
    initPlaySystem();
    
    // 8. ทำให้ระบบเล่นเกมรองรับหมวดหมู่
    enableCategoryPlaySystem();
    
    // 9. ตั้งค่าตัวกรองและการค้นหา
    setupCategoryFilter();
    setupSearchQuestions();
    
    // ตั้งค่าการแสดงผลแท็บเริ่มต้น
    setInitialTabState();
    
    // เริ่มต้นระบบแอดมิน
    initAdminSystem();
    
    // เริ่มระบบตรวจสอบสถานะ Admin
    startAdminStatusMonitor();

    console.log("เริ่มต้นแอปพลิเคชันเรียบร้อยแล้ว");
}

// เพิ่มฟังก์ชันใหม่นี้ถัดจาก initializeApp
function setInitialTabState() {
    // ตรวจสอบแท็บที่กำลังแสดงอยู่
    const activeTabs = document.querySelectorAll('.nav-tab.active');
    if (activeTabs.length > 0) {
        const activeTabId = activeTabs[0].id;
        
        // ซ่อนหน้า login ถ้าไม่ได้อยู่ในแท็บเล่นเกม
        const loginScreen = document.getElementById('login-screen');
        if (loginScreen) {
            if (activeTabId === 'play-tab') {
                // แสดงหน้า login ถ้ายังไม่ได้ login
                if (!currentPlayer) {
                    loginScreen.classList.remove('hidden');
                } else {
                    loginScreen.classList.add('hidden');
                    document.getElementById('start-screen').classList.remove('hidden');
                }
            } else {
                loginScreen.classList.add('hidden');
            }
        }
        
        // เพิ่ม class บน body เพื่อบอกว่ากำลังแสดงแท็บไหน
        document.body.className = 'active-tab-' + activeTabId.replace('-tab', '');
    }
}

// ฟังก์ชันสลับแท็บ - แก้ไขให้รองรับแอดมินแบบสมบูรณ์
function setupTabNavigation() {
    const createTab = document.getElementById('create-tab');
    const playTab = document.getElementById('play-tab');
    const historyTab = document.getElementById('history-tab');
    const createContent = document.getElementById('create-content');
    const playContent = document.getElementById('play-content');
    const historyContent = document.getElementById('history-content');
    const loginScreen = document.getElementById('login-screen');
    
    console.log("Tab elements:", {
        createTab: createTab ? "พบ" : "ไม่พบ", 
        playTab: playTab ? "พบ" : "ไม่พบ", 
        historyTab: historyTab ? "พบ" : "ไม่พบ", 
        createContent: createContent ? "พบ" : "ไม่พบ", 
        playContent: playContent ? "พบ" : "ไม่พบ", 
        historyContent: historyContent ? "พบ" : "ไม่พบ"
    });
    
    // ตรวจสอบว่ามีองค์ประกอบครบหรือไม่
    if (!createTab || !playTab || !historyTab || !createContent || !playContent || !historyContent) {
        console.error("ไม่พบ elements ของแท็บครบถ้วน - จะลองเรียกฟังก์ชันนี้อีกครั้งใน 300ms");
        setTimeout(setupTabNavigation, 300);
        return false;
    }
    
    // สลับไปที่แท็บสร้าง/แก้ไขคำถาม
    createTab.addEventListener('click', function() {
        console.log("กำลังสลับไปที่แท็บสร้าง/แก้ไขคำถาม");
        
        // เปลี่ยนคลาส active ของแท็บ
        createTab.classList.add('active');
        playTab.classList.remove('active');
        historyTab.classList.remove('active');
        
        // เปลี่ยนคลาส active ของเนื้อหา
        createContent.classList.add('active');
        playContent.classList.remove('active');
        historyContent.classList.remove('active');
        
        // ซ่อนหน้าล็อกอินเมื่อสลับไปแท็บสร้าง/แก้ไขคำถาม
        if (loginScreen) loginScreen.classList.add('hidden');
        
        // เพิ่มคลาสเพื่อระบุแท็บที่กำลังแสดง
        document.body.className = 'active-tab-create';
    });

    // สลับไปที่แท็บเล่นเกม - แก้ไขให้รองรับแอดมินสมบูรณ์
    playTab.addEventListener('click', function() {
        console.log("กำลังสลับไปที่แท็บเล่นเกม");
        
        // เปลี่ยนคลาส active ของแท็บ
        createTab.classList.remove('active');
        playTab.classList.add('active');
        historyTab.classList.remove('active');
        
        // เปลี่ยนคลาส active ของเนื้อหา
        createContent.classList.remove('active');
        playContent.classList.add('active');
        historyContent.classList.remove('active');
        
        // เพิ่มคลาสเพื่อระบุแท็บที่กำลังแสดง
        document.body.className = 'active-tab-play';
        
        // ตรวจสอบโหมดแอดมิน
        if (isAdminMode && adminProfile) {
            console.log("อยู่ในโหมดแอดมิน - ข้ามหน้าล็อกอิน");
            
            // ซ่อนหน้าล็อกอิน
            if (loginScreen) loginScreen.classList.add('hidden');
            
            // ตั้งค่าผู้เล่นเป็นแอดมิน (ถ้ายังไม่มี)
            if (!currentPlayer) {
                currentPlayer = {
                    name: adminProfile.name || 'Admin',
                    loginTime: new Date().toISOString(),
                    avatar: '👑'
                };
                console.log("ตั้งค่า currentPlayer เป็นแอดมิน:", currentPlayer);
            }
            
            // แสดงหน้าเล่นเกมและเลือกหมวดหมู่
            const startScreen = document.getElementById('start-screen');
            const categorySelectionContainer = document.getElementById('category-selection-container');
            const quizScreen = document.getElementById('quiz-screen');
            const resultScreen = document.getElementById('result-screen');
            
            // ซ่อนหน้าเกมและผลลัพธ์
            if (quizScreen) quizScreen.classList.add('hidden');
            if (resultScreen) resultScreen.classList.add('hidden');
            
            // แสดงหน้าเริ่มเล่นและเลือกหมวดหมู่
            if (startScreen) startScreen.classList.remove('hidden');
            if (categorySelectionContainer) categorySelectionContainer.classList.remove('hidden');
            
            // อัพเดต UI แสดงชื่อผู้เล่น
            updatePlayerInfoInGame();
            
        } else {
            console.log("โหมดผู้เล่นธรรมดา - ใช้ระบบเดิม");
            // ถ้าไม่ใช่แอดมิน ใช้ระบบเดิม
            updatePlayScreenVisibility();
        }
        
        // อัพเดตตัวเลือกหมวดหมู่ในหน้าเล่นเกม
        updatePlayMainCategorySelect();
    });
    
    // สลับไปที่แท็บประวัติการเล่น - แก้ไขใหม่เพื่อแยก Admin และ Player ชัดเจน
    historyTab.addEventListener('click', function() {
        console.log("กำลังสลับไปที่แท็บประวัติการเล่น");
        
        // เปลี่ยนคลาส active ของแท็บ
        createTab.classList.remove('active');
        playTab.classList.remove('active');
        historyTab.classList.add('active');
        
        // เปลี่ยนคลาส active ของเนื้อหา
        createContent.classList.remove('active');
        playContent.classList.remove('active');
        historyContent.classList.add('active');
        
        // ซ่อนหน้าล็อกอินเมื่อสลับไปแท็บประวัติการเล่น
        if (loginScreen) loginScreen.classList.add('hidden');
        
        // เพิ่มคลาสเพื่อระบุแท็บที่กำลังแสดง
        document.body.className = 'active-tab-history';
        
        // อัพเดตหัวข้อของหน้าประวัติ
        updateHistoryPageHeader();
        
        // **แก้ไขสำคัญ: แยกการแสดงประวัติระหว่าง Admin และ Player**
        if (isAdminMode && adminProfile) {
            console.log("แสดงประวัติแบบแอดมิน - ดูได้ทั้งหมด");
            // Admin: แสดงประวัติทั้งหมดพร้อมตัวกรอง
            displayAdminHistory();
        } else {
            console.log("แสดงประวัติแบบผู้เล่น - ดูเฉพาะของตัวเอง");
            // Player: แสดงเฉพาะประวัติของตัวเอง
            displayPlayerHistory();
        }
    });
    
    console.log("ตั้งค่า Event Listeners สำหรับแท็บเรียบร้อยแล้ว");
    return true;
}

// ฟังก์ชันอัพเดต UI แสดงชื่อผู้เล่นในเกม - เพิ่มใหม่
function updatePlayerInfoInGame() {
    if (!isAdminMode || !currentPlayer) return;
    
    const quizContainer = document.querySelector('.container.quiz-player');
    if (!quizContainer) return;
    
    // ลบข้อมูลผู้เล่นเก่า (ถ้ามี)
    const existingPlayerInfo = quizContainer.querySelector('.player-info.top-right');
    if (existingPlayerInfo) {
        existingPlayerInfo.remove();
    }
    
    // เพิ่มข้อมูลผู้เล่นใหม่
    const playerInfo = document.createElement('div');
    playerInfo.className = 'player-info top-right';
    playerInfo.innerHTML = `
        <div class="player-name">👑 ${currentPlayer.name}</div>
    `;
    quizContainer.appendChild(playerInfo);
    
    console.log("อัพเดต UI แสดงชื่อผู้เล่นแอดมิน:", currentPlayer.name);
}

// ฟังก์ชันโหลดหมวดหมู่จาก Database
async function loadCategories() {
  try {
    // โหลดข้อมูลหมวดหมู่พร้อม is_locked
    const { data, error } = await supabaseClient
      .from('categories')
      .select('*')  // เปลี่ยนจาก select('*') เพื่อให้แน่ใจว่าได้ is_locked มาด้วย
      .order('level', { ascending: true })
      .order('name', { ascending: true });
    
    if (error) {
      console.error('เกิดข้อผิดพลาดในการโหลดหมวดหมู่:', error);
      categories = {};
      return;
    }
    
    // แปลงข้อมูลจาก Database เป็นรูปแบบ nested object เดิม
    // เพิ่มการเก็บข้อมูล is_locked สำหรับหมวดหมู่ย่อย 2
    categories = {};
    
    data.forEach(item => {
      if (item.level === 1) {
        // หมวดหมู่หลัก
        if (!categories[item.name]) {
          categories[item.name] = {};
        }
      } else if (item.level === 2) {
        // หมวดหมู่ย่อย 1
        if (!categories[item.parent_name]) {
          categories[item.parent_name] = {};
        }
        if (!categories[item.parent_name][item.name]) {
          categories[item.parent_name][item.name] = [];
        }
      } else if (item.level === 3) {
        // หมวดหมู่ย่อย 2 - เพิ่มการเก็บข้อมูล is_locked
        const parts = item.parent_name.split(' > ');
        const mainCategory = parts[0];
        const sub1Category = parts[1];
        
        if (!categories[mainCategory]) {
          categories[mainCategory] = {};
        }
        if (!categories[mainCategory][sub1Category]) {
          categories[mainCategory][sub1Category] = [];
        }
        
        // เปลี่ยนจากการเก็บแค่ string เป็น object ที่มี name และ is_locked
        categories[mainCategory][sub1Category].push({
          name: item.name,
          is_locked: item.is_locked || false  // default เป็น false ถ้าเป็น null
        });
      }
    });
    
    console.log('โหลดหมวดหมู่สำเร็จ:', Object.keys(categories).length, 'หมวดหมู่หลัก');
    console.log('ข้อมูลหมวดหมู่พร้อม is_locked:', categories);
    
  } catch (error) {
    console.error('เกิดข้อผิดพลาดที่ไม่คาดคิด:', error);
    categories = {};
  }
}

async function addCategory(type, parent, grandparent) {
    console.log("เริ่มเพิ่มหมวดหมู่:", type, parent, grandparent);

    const categoryName = document.getElementById('category-name').value.trim();
    
    if (!categoryName) {
        alert('กรุณากรอกชื่อหมวดหมู่');
        return false;
    }
    
    try {
        let categoryData = { name: categoryName };
        
        switch (type) {
            case 'main':
                // ตรวจสอบว่ามีหมวดหมู่หลักนี้อยู่แล้วหรือไม่
                const { data: existingMain } = await supabaseClient
                    .from('categories')
                    .select('id')
                    .eq('name', categoryName)
                    .eq('level', 1);
                
                if (existingMain && existingMain.length > 0) {
                    alert('มีหมวดหมู่หลักนี้อยู่แล้ว');
                    return false;
                }
                
                categoryData.level = 1;
                categoryData.parent_name = null;
                break;
                
            case 'sub1':
                if (!parent) {
                    alert('ไม่พบหมวดหมู่หลักที่ระบุ');
                    return false;
                }
                
                // ตรวจสอบว่ามีหมวดหมู่ย่อย 1 นี้อยู่แล้วหรือไม่
                const { data: existingSub1 } = await supabaseClient
                    .from('categories')
                    .select('id')
                    .eq('name', categoryName)
                    .eq('level', 2)
                    .eq('parent_name', parent);
                
                if (existingSub1 && existingSub1.length > 0) {
                    alert('มีหมวดหมู่ย่อย 1 นี้อยู่แล้ว');
                    return false;
                }
                
                categoryData.level = 2;
                categoryData.parent_name = parent;
                break;
                
            case 'sub2':
                if (!parent || !grandparent) {
                    alert('ไม่พบหมวดหมู่ที่ระบุ');
                    return false;
                }
                
                const parentPath = `${parent} > ${grandparent}`;
                
                // ตรวจสอบว่ามีหมวดหมู่ย่อย 2 นี้อยู่แล้วหรือไม่
                const { data: existingSub2 } = await supabaseClient
                    .from('categories')
                    .select('id')
                    .eq('name', categoryName)
                    .eq('level', 3)
                    .eq('parent_name', parentPath);
                
                if (existingSub2 && existingSub2.length > 0) {
                    alert('มีหมวดหมู่ย่อย 2 นี้อยู่แล้ว');
                    return false;
                }
                
                categoryData.level = 3;
                categoryData.parent_name = parentPath;
                break;
                
            default:
                alert('ประเภทหมวดหมู่ไม่ถูกต้อง');
                return false;
        }
        
        // บันทึกลง database
        const { error } = await supabaseClient
            .from('categories')
            .insert([categoryData]);
        
        if (error) {
            throw new Error('เกิดข้อผิดพลาดในการบันทึก: ' + error.message);
        }
        
        console.log("บันทึกหมวดหมู่สำเร็จ:", categoryName);
        
        // โหลดหมวดหมู่ใหม่จาก Database
        await loadCategories();
        
        // ปิดฟอร์ม
        closeAddCategoryForm();
        
        // อัพเดตการแสดงผล
        renderCategoryTree();
        updateCategoryUI();
        
        alert('เพิ่มหมวดหมู่เรียบร้อยแล้ว');
        
        return true;
        
    } catch (error) {
        console.error("เกิดข้อผิดพลาดในการเพิ่มหมวดหมู่:", error);
        alert("เกิดข้อผิดพลาด: " + error.message);
    }
    
    return false;
}

// ลบหมวดหมู่
function deleteMainCategory(mainCategory) {
    if (categories[mainCategory]) {
        delete categories[mainCategory];
        saveCategories();
        updateCategoryUI();
        return true;
    }
    return false;
}

function deleteSubCategory1(mainCategory, subCategory1) {
    if (categories[mainCategory] && categories[mainCategory][subCategory1]) {
        delete categories[mainCategory][subCategory1];
        saveCategories();
        updateCategoryUI();
        return true;
    }
    return false;
}

function deleteSubCategory2(mainCategory, subCategory1, subCategory2) {
    if (categories[mainCategory] && 
        categories[mainCategory][subCategory1] && 
        categories[mainCategory][subCategory1].includes(subCategory2)) {
        
        const index = categories[mainCategory][subCategory1].indexOf(subCategory2);
        categories[mainCategory][subCategory1].splice(index, 1);
        saveCategories();
        updateCategoryUI();
        return true;
    }
    return false;
}

async function updateCategoryUI() {
    console.log("กำลังอัพเดต UI ทั้งหมด...");
    
    // โหลดหมวดหมู่ใหม่จาก database
    await loadCategories();
    
    // อัพเดตตัวเลือกหมวดหมู่ในทุกฟอร์ม
    updateCategorySelects();
    updateQuestionCategorySelects();
    updateFilterMainCategory();
    updatePlayMainCategorySelect();
    
    // รีเซ็ตการแสดงผลคำถามแทนการแสดงทั้งหมด
    resetFiltersAndDisplay();
    
    console.log("อัพเดต UI เรียบร้อยแล้ว");
}

// อัพเดทการแสดงผลแบบ Tree View
function updateCategoriesTree() {
    const treeContainer = document.getElementById('categories-tree');
    treeContainer.innerHTML = '';
    
    for (const mainCategory in categories) {
        const mainCatDiv = document.createElement('div');
        mainCatDiv.className = 'category-item';
        mainCatDiv.innerHTML = `<strong>${mainCategory}</strong>`;
        
        const subCatContainer = document.createElement('div');
        subCatContainer.className = 'sub-categories';
        
        for (const subCategory1 in categories[mainCategory]) {
            const subCat1Div = document.createElement('div');
            subCat1Div.className = 'category-item';
            subCat1Div.innerHTML = `<strong>${subCategory1}</strong>`;
            
            const subCat2Container = document.createElement('div');
            subCat2Container.className = 'sub-categories';
            
            for (const subCategory2 of categories[mainCategory][subCategory1]) {
                const subCat2Div = document.createElement('div');
                subCat2Div.className = 'category-item';
                subCat2Div.textContent = subCategory2;
                subCat2Container.appendChild(subCat2Div);
            }
            
            subCat1Div.appendChild(subCat2Container);
            subCatContainer.appendChild(subCat1Div);
        }
        
        mainCatDiv.appendChild(subCatContainer);
        treeContainer.appendChild(mainCatDiv);
    }
}

// อัพเดท Select สำหรับการเพิ่มหมวดหมู่
function updateCategorySelects() {
    // อัพเดท select สำหรับเพิ่มหมวดหมู่
    const newMainCategorySelect = document.getElementById('new-main-category');
    if (newMainCategorySelect) {
        // เก็บตัวเลือกแรกไว้
        const firstOption = newMainCategorySelect.options[0];
        newMainCategorySelect.innerHTML = '';
        newMainCategorySelect.appendChild(firstOption);
        
        // เพิ่มหมวดหมู่หลักที่มีอยู่
        for (const mainCategory in categories) {
            const option = document.createElement('option');
            option.value = mainCategory;
            option.textContent = mainCategory;
            newMainCategorySelect.appendChild(option);
        }
    }
    
    // อัพเดท select ในฟอร์มคำถาม
    updateQuestionCategorySelects();
}

// อัพเดท Select สำหรับการแก้ไข/ลบหมวดหมู่
function updateEditCategorySelects() {
    const editMainCategory = document.getElementById('edit-main-category');
    const editSubCategory1 = document.getElementById('edit-sub-category1');
    const editSubCategory2 = document.getElementById('edit-sub-category2');
    
    if (editMainCategory) {
        editMainCategory.innerHTML = '<option value="">เลือกหมวดหมู่หลัก</option>';
        
        for (const mainCategory in categories) {
            const option = document.createElement('option');
            option.value = mainCategory;
            option.textContent = mainCategory;
            editMainCategory.appendChild(option);
        }
    }
    
    // รีเซ็ตอื่นๆ
    if (editSubCategory1) {
        editSubCategory1.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 1</option>';
        editSubCategory1.disabled = true;
    }
    
    if (editSubCategory2) {
        editSubCategory2.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 2</option>';
        editSubCategory2.disabled = true;
    }
}

// ฟังก์ชันอัพเดท Select ในฟอร์มคำถาม
function updateQuestionCategorySelects() {
    const questionMainCategory = document.getElementById('question-main-category');
    const questionSubCategory1 = document.getElementById('question-sub-category1');
    const questionSubCategory2 = document.getElementById('question-sub-category2');
    
    if (questionMainCategory) {
        // เก็บตัวเลือกแรกไว้
        const firstOption = questionMainCategory.options[0];
        questionMainCategory.innerHTML = '';
        questionMainCategory.appendChild(firstOption);
        
        // เพิ่มหมวดหมู่หลักที่มีอยู่
        for (const mainCategory in categories) {
            const option = document.createElement('option');
            option.value = mainCategory;
            option.textContent = mainCategory;
            questionMainCategory.appendChild(option);
        }
    }
    
    // รีเซ็ตตัวเลือกหมวดหมู่ย่อย
    if (questionSubCategory1) {
        questionSubCategory1.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 1</option>';
        questionSubCategory1.disabled = true;
    }
    
    if (questionSubCategory2) {
        questionSubCategory2.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 2</option>';
        questionSubCategory2.disabled = true;
    }
    
    console.log("อัพเดตตัวเลือกหมวดหมู่ในฟอร์มคำถามเรียบร้อย");
}

// ตั้งค่า Event Listeners สำหรับเลือกหมวดหมู่ในฟอร์มคำถาม
function setupQuestionCategoryListeners() {
    console.log("กำลังตั้งค่า Event Listeners สำหรับตัวเลือกหมวดหมู่ในฟอร์มคำถาม...");
    
    const questionMainCategory = document.getElementById('question-main-category');
    const questionSubCategory1 = document.getElementById('question-sub-category1');
    const questionSubCategory2 = document.getElementById('question-sub-category2');
    
    if (questionMainCategory) {
        // ลบ event listener เดิม (ถ้ามี)
        const newMainCategory = questionMainCategory.cloneNode(true);
        questionMainCategory.parentNode.replaceChild(newMainCategory, questionMainCategory);
        
        // เพิ่ม event listener ใหม่
        newMainCategory.addEventListener('change', function() {
    console.log("เลือกหมวดหมู่หลัก:", this.value);
    const mainCategory = this.value;
    
    // รีเซ็ตค่าของ dropdown หมวดย่อย - เพิ่มบรรทัดนี้
    document.getElementById('question-sub-category1').value = '';
    document.getElementById('question-sub-category2').value = '';
    
    // รีเซ็ตตัวเลือกหมวดย่อย 2 - เพิ่มบรรทัดนี้
    document.getElementById('question-sub-category2').innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 2</option>';
    document.getElementById('question-sub-category2').disabled = true;
    
    if (mainCategory) {
        updateSubCategory1Select(document.getElementById('question-sub-category1'), mainCategory);
    } else {
        document.getElementById('question-sub-category1').innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 1</option>';
        document.getElementById('question-sub-category1').disabled = true;
    }
});
    }
    
    if (questionSubCategory1) {
        // ลบ event listener เดิม (ถ้ามี)
        const newSubCategory1 = questionSubCategory1.cloneNode(true);
        questionSubCategory1.parentNode.replaceChild(newSubCategory1, questionSubCategory1);
        
        // เพิ่ม event listener ใหม่
        newSubCategory1.addEventListener('change', function() {
    console.log("เลือกหมวดหมู่ย่อย 1:", this.value);
    const mainCategory = document.getElementById('question-main-category').value;
    const subCategory1 = this.value;
    
    // รีเซ็ตค่าของ dropdown หมวดย่อย 2 - เพิ่มบรรทัดนี้
    document.getElementById('question-sub-category2').value = '';
    
    if (mainCategory && subCategory1) {
        updateSubCategory2Select(document.getElementById('question-sub-category2'), mainCategory, subCategory1);
    } else {
        document.getElementById('question-sub-category2').innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 2</option>';
        document.getElementById('question-sub-category2').disabled = true;
    }
});
    }
    
    console.log("ตั้งค่า Event Listeners สำหรับตัวเลือกหมวดหมู่ในฟอร์มคำถามเรียบร้อยแล้ว");
}

// ฟังก์ชันปรับปรุงใหม่สำหรับ radio buttons
function setupChoiceRadioButtons() {
  // เลือกทุก radio button ในฟอร์มแบบตรงไปตรงมา
  const radioButtons = document.querySelectorAll('input[name="correct-answer"]');
  
  // ล้างสถานะการเลือกทั้งหมด (ป้องกันการค้างสถานะ)
  radioButtons.forEach(radio => {
    radio.checked = false;
    
    // ลบ event listener เดิม (ถ้ามี) โดยใช้ replaceWith แทน cloneNode
    radio.addEventListener('click', function() {
      console.log("เลือกคำตอบที่ถูกต้อง:", this.value);
    });
  });
}

// อัพเดทหมวดหมู่ย่อย 1 เมื่อเลือกหมวดหมู่หลัก
function updateSubCategory1Select(selectElement, mainCategory) {
    selectElement.innerHTML = '';
    
    // นับคำถามในแต่ละหมวดหมู่
    const categoryCount = countQuestionsInCategory();
    
    // เพิ่ม placeholder ที่ซ่อนจากรายการ
    const placeholderOption = document.createElement('option');
    placeholderOption.value = "";
    placeholderOption.textContent = "เลือกหมวดหมู่ย่อย 1";
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    placeholderOption.style.display = "none"; // ซ่อนจากรายการ dropdown
    selectElement.appendChild(placeholderOption);
    
    if (mainCategory && categories[mainCategory]) {
        for (const subCategory1 in categories[mainCategory]) {
            const sub1Key = `${mainCategory}|${subCategory1}`;
            const questionCount = categoryCount[sub1Key] || 0;
            const option = document.createElement('option');
            option.value = subCategory1;
            option.textContent = `${subCategory1} (${questionCount})`;
            selectElement.appendChild(option);
        }
        selectElement.disabled = false;
    } else {
        selectElement.disabled = true;
    }
}

// ฟังก์ชันอัพเดทหมวดหมู่ย่อย 2 เมื่อเลือกหมวดหมู่ย่อย 1
function updateSubCategory2Select(selectElement, mainCategory, subCategory1) {
    selectElement.innerHTML = '';
    
    // นับคำถามในแต่ละหมวดหมู่
    const categoryCount = countQuestionsInCategory();
    
    // เพิ่ม placeholder ที่ซ่อนจากรายการ
    const placeholderOption = document.createElement('option');
    placeholderOption.value = "";
    placeholderOption.textContent = "เลือกหมวดหมู่ย่อย 2";
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    placeholderOption.style.display = "none"; // ซ่อนจากรายการ dropdown
    selectElement.appendChild(placeholderOption);
    
    if (mainCategory && subCategory1 && 
        categories[mainCategory] && 
        categories[mainCategory][subCategory1]) {
        
        // วนลูปหมวดหมู่ย่อย 2 ที่เป็น object แบบใหม่
        for (const subCategory2Item of categories[mainCategory][subCategory1]) {
            const option = document.createElement('option');
            
            // ตรวจสอบว่าเป็น object หรือ string
            if (typeof subCategory2Item === 'object' && subCategory2Item.name) {
                // กรณีที่เป็น object ใหม่
                const subCategory2Name = subCategory2Item.name;
                const sub2Key = `${mainCategory}|${subCategory1}|${subCategory2Name}`;
                const questionCount = categoryCount[sub2Key] || 0;
                
                option.value = subCategory2Name;
                
                // แสดงไอคอนล็อกถ้าหมวดหมู่ถูกล็อก
                const lockIcon = subCategory2Item.is_locked ? ' 🔒' : '';
                option.textContent = `${subCategory2Name} (${questionCount})${lockIcon}`;
                
                // ตรวจสอบสิทธิ์การเข้าถึง - ถ้าล็อกและไม่ใช่ admin ให้ disable
                if (subCategory2Item.is_locked && !canPlayerAccessCategory(mainCategory, subCategory1, subCategory2Name)) {
                    option.disabled = true;
                    option.style.color = '#999999';
                    option.style.backgroundColor = '#f5f5f5';
                }
            } else {
                // กรณีที่เป็น string เก่า (backward compatibility)
                const sub2Key = `${mainCategory}|${subCategory1}|${subCategory2Item}`;
                const questionCount = categoryCount[sub2Key] || 0;
                option.value = subCategory2Item;
                option.textContent = `${subCategory2Item} (${questionCount})`;
            }
            
            selectElement.appendChild(option);
        }
        selectElement.disabled = false;
    } else {
        selectElement.disabled = true;
    }
}

// ฟังก์ชันสำหรับตรวจสอบว่าหมวดหมู่ถูกล็อกหรือไม่
function isCategoryLocked(mainCategory, subCategory1, subCategory2) {
    try {
        if (!categories[mainCategory] || !categories[mainCategory][subCategory1]) {
            return false;
        }
        
        const subCategory2List = categories[mainCategory][subCategory1];
        
        // หาหมวดหมู่ย่อย 2 ที่ตรงกัน
        for (const subCategory2Item of subCategory2List) {
            if (typeof subCategory2Item === 'object' && subCategory2Item.name) {
                // กรณีที่เป็น object ใหม่
                if (subCategory2Item.name === subCategory2) {
                    return subCategory2Item.is_locked || false;
                }
            } else {
                // กรณีที่เป็น string เก่า (ไม่มีการล็อก)
                if (subCategory2Item === subCategory2) {
                    return false;
                }
            }
        }
        
        return false;
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการตรวจสอบการล็อก:', error);
        return false;
    }
}

// ฟังก์ชันจัดการ Event Listeners
function setupCategoryEventListeners() {
    // แท็บจัดการหมวดหมู่
    const viewCategoriesTab = document.getElementById('view-categories-tab');
    const addCategoryTab = document.getElementById('add-category-tab');
    const editCategoryTab = document.getElementById('edit-category-tab');
    
    const viewCategoriesContent = document.getElementById('view-categories-content');
    const addCategoryContent = document.getElementById('add-category-content');
    const editCategoryContent = document.getElementById('edit-category-content');
    
    // สลับแท็บหมวดหมู่
    if (viewCategoriesTab) {
        viewCategoriesTab.addEventListener('click', function() {
            viewCategoriesTab.classList.add('active');
            addCategoryTab.classList.remove('active');
            editCategoryTab.classList.remove('active');
            
            viewCategoriesContent.classList.add('active');
            addCategoryContent.classList.remove('active');
            editCategoryContent.classList.remove('active');
        });
    }
    
    if (addCategoryTab) {
        addCategoryTab.addEventListener('click', function() {
            viewCategoriesTab.classList.remove('active');
            addCategoryTab.classList.add('active');
            editCategoryTab.classList.remove('active');
            
            viewCategoriesContent.classList.remove('active');
            addCategoryContent.classList.add('active');
            editCategoryContent.classList.remove('active');
        });
    }
    
    if (editCategoryTab) {
        editCategoryTab.addEventListener('click', function() {
            viewCategoriesTab.classList.remove('active');
            addCategoryTab.classList.remove('active');
            editCategoryTab.classList.add('active');
            
            viewCategoriesContent.classList.remove('active');
            addCategoryContent.classList.remove('active');
            editCategoryContent.classList.add('active');
        });
    }
    
    // ปุ่มบันทึกหมวดหมู่
    const saveCategoryBtn = document.getElementById('save-category');
    if (saveCategoryBtn) {
        saveCategoryBtn.addEventListener('click', function() {
            const newMainCategorySelect = document.getElementById('new-main-category');
            const newMainCategoryText = document.getElementById('new-main-category-text');
            const newSubCategory1Select = document.getElementById('new-sub-category1');
            const newSubCategory1Text = document.getElementById('new-sub-category1-text');
            const newSubCategory2Select = document.getElementById('new-sub-category2');
            const newSubCategory2Text = document.getElementById('new-sub-category2-text');
            
            let mainCategory, subCategory1, subCategory2;
            
            // ตรวจสอบและใช้ค่าหมวดหมู่หลัก
            if (newMainCategorySelect.value === 'new') {
                if (newMainCategoryText.value.trim() === '') {
                    alert('กรุณาระบุชื่อหมวดหมู่หลักใหม่');
                    return;
                }
                mainCategory = newMainCategoryText.value.trim();
            } else {
                mainCategory = newMainCategorySelect.value;
            }
            
            // ตรวจสอบและใช้ค่าหมวดหมู่ย่อย 1
            if (newSubCategory1Select.value === 'new') {
                if (newSubCategory1Text.value.trim() === '') {
                    alert('กรุณาระบุชื่อหมวดหมู่ย่อย 1 ใหม่');
                    return;
                }
                subCategory1 = newSubCategory1Text.value.trim();
            } else if (newSubCategory1Select.value) {
                subCategory1 = newSubCategory1Select.value;
            } else {
                subCategory1 = '';
            }
            
            // ตรวจสอบและใช้ค่าหมวดหมู่ย่อย 2
            if (newSubCategory2Select.value === 'new') {
                if (newSubCategory2Text.value.trim() === '') {
                    alert('กรุณาระบุชื่อหมวดหมู่ย่อย 2 ใหม่');
                    return;
                }
                subCategory2 = newSubCategory2Text.value.trim();
            } else if (newSubCategory2Select.value) {
                subCategory2 = newSubCategory2Select.value;
            } else {
                subCategory2 = '';
            }
            
            // ตรวจสอบค่าขั้นต่ำ
            if (!mainCategory) {
                alert('กรุณาเลือกหรือระบุหมวดหมู่หลัก');
                return;
            }
            
            if (!subCategory1) {
                alert('กรุณาเลือกหรือระบุหมวดหมู่ย่อย 1');
                return;
            }
            
            // เพิ่มหมวดหมู่
            addCategory(mainCategory, subCategory1, subCategory2);
            
            // รีเซ็ตฟอร์ม
            newMainCategoryText.value = '';
            newSubCategory1Text.value = '';
            newSubCategory2Text.value = '';
            newMainCategorySelect.value = 'new';
            newSubCategory1Select.value = 'new';
            newSubCategory2Select.value = 'new';
            
            alert('บันทึกหมวดหมู่เรียบร้อยแล้ว');
        });
    }
    
    // Event Listeners สำหรับ Selects ในฟอร์มเพิ่มหมวดหมู่
    const newMainCategorySelect = document.getElementById('new-main-category');
    const newSubCategory1Select = document.getElementById('new-sub-category1');
    
    if (newMainCategorySelect) {
        newMainCategorySelect.addEventListener('change', function() {
            const mainCategory = this.value;
            const newMainCategoryText = document.getElementById('new-main-category-text');
            
            if (mainCategory === 'new') {
                newMainCategoryText.style.display = 'block';
                // รีเซ็ตหมวดหมู่ย่อย
                if (newSubCategory1Select) {
                    newSubCategory1Select.innerHTML = '<option value="new">+ สร้างหมวดหมู่ย่อย 1 ใหม่</option>';
                }
            } else {
                newMainCategoryText.style.display = 'none';
                
                // อัพเดตตัวเลือกหมวดหมู่ย่อย 1
                if (newSubCategory1Select) {
                    newSubCategory1Select.innerHTML = '<option value="new">+ สร้างหมวดหมู่ย่อย 1 ใหม่</option>';
                    
                    if (categories[mainCategory]) {
                        for (const subCategory1 in categories[mainCategory]) {
                            const option = document.createElement('option');
                            option.value = subCategory1;
                            option.textContent = subCategory1;
                            newSubCategory1Select.appendChild(option);
                        }
                    }
                }
            }
        });
    }
    
    if (newSubCategory1Select) {
        newSubCategory1Select.addEventListener('change', function() {
            const mainCategory = newMainCategorySelect.value;
            const subCategory1 = this.value;
            const newSubCategory1Text = document.getElementById('new-sub-category1-text');
            const newSubCategory2Select = document.getElementById('new-sub-category2');
            
            if (subCategory1 === 'new') {
                newSubCategory1Text.style.display = 'block';
                // รีเซ็ตหมวดหมู่ย่อย 2
                if (newSubCategory2Select) {
                    newSubCategory2Select.innerHTML = '<option value="new">+ สร้างหมวดหมู่ย่อย 2 ใหม่</option>';
                }
            } else {
                newSubCategory1Text.style.display = 'none';
                
                // อัพเดตตัวเลือกหมวดหมู่ย่อย 2
                if (newSubCategory2Select && mainCategory !== 'new' && categories[mainCategory] && categories[mainCategory][subCategory1]) {
                    newSubCategory2Select.innerHTML = '<option value="new">+ สร้างหมวดหมู่ย่อย 2 ใหม่</option>';
                    
                    for (const subCategory2 of categories[mainCategory][subCategory1]) {
                        const option = document.createElement('option');
                        option.value = subCategory2;
                        option.textContent = subCategory2;
                        newSubCategory2Select.appendChild(option);
                    }
                }
            }
        });
    }
    
    // Event Listeners สำหรับการแก้ไข/ลบหมวดหมู่
    const editMainCategory = document.getElementById('edit-main-category');
    const editSubCategory1 = document.getElementById('edit-sub-category1');
    const editSubCategory2 = document.getElementById('edit-sub-category2');
    
    if (editMainCategory) {
        editMainCategory.addEventListener('change', function() {
            const mainCategory = this.value;
            
            if (mainCategory) {
                updateSubCategory1Select(editSubCategory1, mainCategory);
            } else {
                editSubCategory1.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 1</option>';
                editSubCategory1.disabled = true;
                editSubCategory2.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 2</option>';
                editSubCategory2.disabled = true;
            }
        });
    }
    
    if (editSubCategory1) {
        editSubCategory1.addEventListener('change', function() {
            const mainCategory = editMainCategory.value;
            const subCategory1 = this.value;
            
            if (mainCategory && subCategory1) {
                updateSubCategory2Select(editSubCategory2, mainCategory, subCategory1);
            } else {
                editSubCategory2.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 2</option>';
                editSubCategory2.disabled = true;
            }
        });
    }
    
    // ปุ่มลบหมวดหมู่
    const deleteMainCategoryBtn = document.getElementById('delete-main-category');
    const deleteSubCategory1Btn = document.getElementById('delete-sub-category1');
    const deleteSubCategory2Btn = document.getElementById('delete-sub-category2');
    
    if (deleteMainCategoryBtn) {
        deleteMainCategoryBtn.addEventListener('click', function() {
            const mainCategory = editMainCategory.value;
            
            if (!mainCategory) {
                alert('กรุณาเลือกหมวดหมู่หลักที่ต้องการลบ');
                return;
            }
            
            if (confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่หลัก "${mainCategory}" และหมวดหมู่ย่อยทั้งหมด?`)) {
                if (deleteMainCategory(mainCategory)) {
                    alert('ลบหมวดหมู่หลักเรียบร้อยแล้ว');
                    
                    // รีเซ็ตการเลือก
                    editMainCategory.value = '';
                    editSubCategory1.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 1</option>';
                    editSubCategory1.disabled = true;
                    editSubCategory2.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 2</option>';
                    editSubCategory2.disabled = true;
                } else {
                    alert('เกิดข้อผิดพลาดในการลบหมวดหมู่หลัก');
                }
            }
        });
    }
    
    if (deleteSubCategory1Btn) {
        deleteSubCategory1Btn.addEventListener('click', function() {
            const mainCategory = editMainCategory.value;
            const subCategory1 = editSubCategory1.value;
            
            if (!mainCategory) {
                alert('กรุณาเลือกหมวดหมู่หลัก');
                return;
            }
            
            if (!subCategory1) {
                alert('กรุณาเลือกหมวดหมู่ย่อย 1 ที่ต้องการลบ');
                return;
            }
            
            if (confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่ย่อย 1 "${subCategory1}" และหมวดหมู่ย่อย 2 ทั้งหมด?`)) {
                if (deleteSubCategory1(mainCategory, subCategory1)) {
                    alert('ลบหมวดหมู่ย่อย 1 เรียบร้อยแล้ว');
                    
                    // รีเซ็ตการเลือกหมวดหมู่ย่อย
                    updateSubCategory1Select(editSubCategory1, mainCategory);
                    editSubCategory2.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 2</option>';
                    editSubCategory2.disabled = true;
                } else {
                    alert('เกิดข้อผิดพลาดในการลบหมวดหมู่ย่อย 1');
                }
            }
        });
    }
    
    if (deleteSubCategory2Btn) {
        deleteSubCategory2Btn.addEventListener('click', function() {
            const mainCategory = editMainCategory.value;
            const subCategory1 = editSubCategory1.value;
            const subCategory2 = editSubCategory2.value;
            
            if (!mainCategory) {
                alert('กรุณาเลือกหมวดหมู่หลัก');
                return;
            }
            
            if (!subCategory1) {
                alert('กรุณาเลือกหมวดหมู่ย่อย 1');
                return;
            }
            
            if (!subCategory2) {
                alert('กรุณาเลือกหมวดหมู่ย่อย 2 ที่ต้องการลบ');
                return;
            }
            
            if (confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่ย่อย 2 "${subCategory2}"?`)) {
                if (deleteSubCategory2(mainCategory, subCategory1, subCategory2)) {
                    alert('ลบหมวดหมู่ย่อย 2 เรียบร้อยแล้ว');
                    
                    // รีเซ็ตการเลือกหมวดหมู่ย่อย 2
                    updateSubCategory2Select(editSubCategory2, mainCategory, subCategory1);
                } else {
                    alert('เกิดข้อผิดพลาดในการลบหมวดหมู่ย่อย 2');
                }
            }
        });
    }
    
    // Event Listeners สำหรับ Select ในฟอร์มคำถาม
    const questionMainCategory = document.getElementById('question-main-category');
    const questionSubCategory1 = document.getElementById('question-sub-category1');
    const questionSubCategory2 = document.getElementById('question-sub-category2');
    
    if (questionMainCategory) {
        questionMainCategory.addEventListener('change', function() {
            const mainCategory = this.value;
            
            if (mainCategory) {
                updateSubCategory1Select(questionSubCategory1, mainCategory);
            } else {
                questionSubCategory1.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 1</option>';
                questionSubCategory1.disabled = true;
                questionSubCategory2.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 2</option>';
                questionSubCategory2.disabled = true;
            }
        });
    }
    
    if (questionSubCategory1) {
        questionSubCategory1.addEventListener('change', function() {
            const mainCategory = questionMainCategory.value;
            const subCategory1 = this.value;
            
            if (mainCategory && subCategory1) {
                updateSubCategory2Select(questionSubCategory2, mainCategory, subCategory1);
            } else {
                questionSubCategory2.innerHTML = '<option value="">เลือกหมวดหมู่ย่อย 2</option>';
                questionSubCategory2.disabled = true;
            }
        });
    }
}

// ฟังก์ชันปรับปรุงระบบบันทึกคำถาม
function updateQuestionSystem() {
    // จัดการเมื่อบันทึกคำถาม
    const saveQuestionBtn = document.getElementById('save-question');
    if (saveQuestionBtn) {
        // ดึง event listener เดิมออก (ถ้ามี)
        const oldClickEvent = saveQuestionBtn.onclick;
        
        // แทนที่ด้วย event listener ใหม่
        saveQuestionBtn.onclick = function(event) {
            // ตรวจสอบหมวดหมู่
            const mainCategory = document.getElementById('question-main-category').value;
            const subCategory1 = document.getElementById('question-sub-category1').value;
            const subCategory2 = document.getElementById('question-sub-category2').value;
            
            // ตรวจสอบว่าต้องเลือกหมวดหมู่ครบทั้ง 3 ระดับหรือไม่
            if (!mainCategory) {
                alert('กรุณาเลือกหมวดหมู่หลัก');
                event.preventDefault();
                return false;
            }
            
            if (!subCategory1) {
                alert('กรุณาเลือกหมวดหมู่ย่อย 1');
                event.preventDefault();
                return false;
            }
            
            if (!subCategory2) {
                alert('กรุณาเลือกหมวดหมู่ย่อย 2');
                event.preventDefault();
                return false;
            }
            
            // เรียกใช้ event listener เดิมถ้ามี
            if (typeof oldClickEvent === 'function') {
                return oldClickEvent.call(this, event);
            }
        };
    }
}

// ฟังก์ชันบันทึกคำถามลง Database
async function saveQuestion() {
  const questionText = document.getElementById('question-text').value.trim();
  const choiceA = document.getElementById('choice-a').value.trim();
  const choiceB = document.getElementById('choice-b').value.trim();
  const choiceC = document.getElementById('choice-c').value.trim();
  const choiceD = document.getElementById('choice-d').value.trim();
  
  const correctAnswerElem = document.querySelector('input[name="correct-answer"]:checked');
  const correctAnswer = correctAnswerElem ? correctAnswerElem.value : null;
  
  // ตรวจสอบข้อมูลจำเป็น
  if (!questionText) {
    alert('กรุณากรอกคำถาม');
    return false;
  }
  
  if (!choiceA || !choiceB || !choiceC || !choiceD) {
    alert('กรุณากรอกตัวเลือกให้ครบทุกข้อ');
    return false;
  }
  
  if (!correctAnswer) {
    alert('กรุณาเลือกคำตอบที่ถูกต้อง');
    return false;
  }
  
  // ตรวจสอบหมวดหมู่
  const mainCategory = document.getElementById('question-main-category').value;
  const subCategory1 = document.getElementById('question-sub-category1').value;
  const subCategory2 = document.getElementById('question-sub-category2').value;
  
  if (!mainCategory || !subCategory1 || !subCategory2) {
    alert('กรุณาเลือกหมวดหมู่ให้ครบทั้ง 3 ระดับ');
    return false;
  }
  
  // ตรวจสอบรูปภาพ
  let imageValue = null;
  const imagePreview = document.getElementById('image-preview');
  if (imagePreview.src && imagePreview.src !== "about:blank" && 
      imagePreview.style.display !== 'none' &&
      (imagePreview.src.startsWith('data:') || 
       imagePreview.src.startsWith('http://') || 
       imagePreview.src.startsWith('https://'))) {
    imageValue = imagePreview.src;
  }

  // สร้างข้อมูลคำถาม
  const questionData = {
    text: questionText,
    image_url: imageValue,
    choices: JSON.stringify([
      { id: 'A', text: choiceA },
      { id: 'B', text: choiceB },
      { id: 'C', text: choiceC },
      { id: 'D', text: choiceD }
    ]),
    correct_answer: correctAnswer,
    category_main: mainCategory,
    category_sub1: subCategory1,
    category_sub2: subCategory2
  };
  
  try {
    // บันทึกลง Supabase
    const { data, error } = await supabaseClient
      .from('questions')
      .insert([questionData])
      .select();
    
    if (error) {
      console.error('เกิดข้อผิดพลาดในการบันทึก:', error);
      alert('เกิดข้อผิดพลาดในการบันทึกคำถาม: ' + error.message);
      return false;
    }
    
    console.log('บันทึกคำถามสำเร็จ:', data);
    
    // โหลดคำถามใหม่จาก Database
    await loadQuestions();
    
    // รีเซ็ตตัวกรองและแสดงข้อความ "กรุณาเลือกหมวดหมู่"
    resetFiltersAndDisplay();
    
    // อัพเดตการแสดงผลหมวดหมู่ (tree)
    renderCategoryTree();
    
    // รีเซ็ตฟอร์ม
    clearForm();
    
    alert('บันทึกคำถามเรียบร้อยแล้ว');
    return true;
    
  } catch (error) {
    console.error('เกิดข้อผิดพลาดที่ไม่คาดคิด:', error);
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล');
    return false;
  }
}

function resetFiltersAndDisplay() {
    // รีเซ็ตตัวกรองทั้งหมด
    const filterMainCategory = document.getElementById('filter-main-category');
    const filterSubCategory1 = document.getElementById('filter-sub-category1');
    const filterSubCategory2 = document.getElementById('filter-sub-category2');
    const searchInput = document.getElementById('search-questions');
    
    if (filterMainCategory) {
        filterMainCategory.value = '';
    }
    
    if (filterSubCategory1) {
        filterSubCategory1.innerHTML = '<option value="">ทุกหมวดหมู่ย่อย 1</option>';
        filterSubCategory1.disabled = true;
    }
    
    if (filterSubCategory2) {
        filterSubCategory2.innerHTML = '<option value="">ทุกหมวดหมู่ย่อย 2</option>';
        filterSubCategory2.disabled = true;
    }
    
    if (searchInput) {
        searchInput.value = '';
    }
    
    // แสดงข้อความ "กรุณาเลือกหมวดหมู่"
    displayFilteredQuestions([], false, true);
}

// ฟังก์ชันโหลดคำถามจาก Database
async function loadQuestions() {
  try {
    const { data, error } = await supabaseClient
      .from('questions')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('เกิดข้อผิดพลาดในการโหลดคำถาม:', error);
      questions = []; // ใช้ array ว่างถ้าโหลดไม่ได้
      return;
    }
    
    // แปลงข้อมูลจาก Database เป็นรูปแบบที่โค้ดเดิมใช้
    questions = data.map(item => ({
      id: item.id.toString(),
      text: item.text,
      image: item.image_url,
      choices: JSON.parse(item.choices),
      correctAnswer: item.correct_answer,
      category: {
        main: item.category_main,
        sub1: item.category_sub1,
        sub2: item.category_sub2
      }
    }));
    
    console.log('โหลดคำถามสำเร็จ:', questions.length, 'ข้อ');
    
  } catch (error) {
    console.error('เกิดข้อผิดพลาดที่ไม่คาดคิด:', error);
    questions = [];
  }
}

// ฟังก์ชันโหลดประวัติการเล่นจาก Database
async function loadGameHistory() {
    try {
        const { data, error } = await supabaseClient
            .from('game_history')
            .select('*')
            .order('played_at', { ascending: false });

        if (error) {
            console.error('เกิดข้อผิดพลาดในการโหลดประวัติ:', error);
            gameHistory = [];
            filteredHistory = [];
            return;
        }

        // แปลงข้อมูลจาก Database เป็นรูปแบบที่โค้ดเดิมใช้
        gameHistory = data.map(item => ({
            id: item.id.toString(),
            playerName: item.player_name,
            score: item.score,
            totalQuestions: item.total_questions,
            percentage: item.percentage,
            category: JSON.parse(item.category || '{}'),
            playedAt: item.played_at,
            gameData: JSON.parse(item.game_data || '{}')
        }));

        filteredHistory = [...gameHistory];
        console.log('โหลดประวัติการเล่นสำเร็จ:', gameHistory.length, 'รายการ');

    } catch (error) {
        console.error('เกิดข้อผิดพลาดที่ไม่คาดคิด:', error);
        gameHistory = [];
        filteredHistory = [];
    }
}

// นำไปแทนที่ฟังก์ชัน displayQuestions ทั้งหมด
function displayQuestions(filtered = false, isReset = false) {
    if (filtered) {
        // ถ้ามีการระบุว่ามีการกรอง ให้เรียกใช้ฟังก์ชันกรอง
        applyFilters(isReset);
    } else {
        // ถ้าไม่มีการกรอง แสดงคำถามทั้งหมด หรือไม่แสดงเลยถ้าเป็นการรีเซ็ต
        displayFilteredQuestions(questions, false, isReset);
    }
    return true;
}

// ฟังก์ชันล้างฟอร์ม
function clearForm() {
  document.getElementById('question-text').value = '';
  document.getElementById('choice-a').value = '';
  document.getElementById('choice-b').value = '';
  document.getElementById('choice-c').value = '';
  document.getElementById('choice-d').value = '';
  
  // ล้างการเลือกตัวเลือกถูกต้อง - วิธีที่เรียบง่ายกว่า
  const radioButtons = document.querySelectorAll('input[name="correct-answer"]');
  radioButtons.forEach(radio => {
    radio.checked = false;
  });
  
  // ล้างรูปภาพ
  const imagePreview = document.getElementById('image-preview');
  imagePreview.src = '';
  imagePreview.style.display = 'none';
  document.getElementById('question-image').value = '';
  
  // รีเซ็ตการเลือกหมวดหมู่
  document.getElementById('question-main-category').value = '';
  document.getElementById('question-sub-category1').value = '';
  document.getElementById('question-sub-category2').disabled = true;
  document.getElementById('question-sub-category1').disabled = true;
}
// แทนที่ฟังก์ชัน deleteQuestion() เดิมด้วยโค้ดนี้
async function deleteQuestion(questionId) {
    if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบคำถามนี้?')) {
        try {
            // ลบจาก Supabase Database
            const { error } = await supabaseClient
                .from('questions')
                .delete()
                .eq('id', questionId);
            
            if (error) {
                console.error('เกิดข้อผิดพลาดในการลบคำถาม:', error);
                alert('เกิดข้อผิดพลาดในการลบคำถาม: ' + error.message);
                return;
            }
            
            // โหลดคำถามใหม่จาก Database
            await loadQuestions();
            
            // อัพเดตการแสดงผล
            displayQuestions();
            
            // อัพเดตตัวเลขแสดงจำนวนคำถามในหมวดหมู่
            renderCategoryTree();
            
            console.log('ลบคำถามสำเร็จ ID:', questionId);
            alert('ลบคำถามเรียบร้อยแล้ว');
            
        } catch (error) {
            console.error('เกิดข้อผิดพลาดที่ไม่คาดคิด:', error);
            alert('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล');
        }
    }
}

// แทนที่ฟังก์ชัน editQuestion() เดิมด้วยโค้ดนี้
async function editQuestion(questionId) {
    const question = questions.find(q => q.id === questionId);
    
    if (question) {
        try {
            // เติมข้อมูลในฟอร์ม
            document.getElementById('question-text').value = question.text;
            document.getElementById('choice-a').value = question.choices.find(c => c.id === 'A')?.text || '';
            document.getElementById('choice-b').value = question.choices.find(c => c.id === 'B')?.text || '';
            document.getElementById('choice-c').value = question.choices.find(c => c.id === 'C')?.text || '';
            document.getElementById('choice-d').value = question.choices.find(c => c.id === 'D')?.text || '';
            
            // เลือกคำตอบที่ถูกต้อง
            const correctRadio = document.querySelector(`input[name="correct-answer"][value="${question.correctAnswer}"]`);
            if (correctRadio) {
                correctRadio.checked = true;
            }
            
            // แสดงรูปภาพ (ถ้ามี)
            const imagePreview = document.getElementById('image-preview');
            if (question.image) {
                imagePreview.src = question.image;
                imagePreview.style.display = 'block';
            } else {
                imagePreview.src = '';
                imagePreview.style.display = 'none';
            }
            
            // เลือกหมวดหมู่
            if (question.category) {
                const mainCategorySelect = document.getElementById('question-main-category');
                mainCategorySelect.value = question.category.main || '';
                
                // อัพเดต dropdown หมวดหมู่ย่อย 1
                if (question.category.main) {
                    updateSubCategory1Select(
                        document.getElementById('question-sub-category1'),
                        question.category.main
                    );
                    
                    // เลือกหมวดหมู่ย่อย 1
                    document.getElementById('question-sub-category1').value = question.category.sub1 || '';
                    
                    // อัพเดต dropdown หมวดหมู่ย่อย 2
                    if (question.category.sub1) {
                        updateSubCategory2Select(
                            document.getElementById('question-sub-category2'),
                            question.category.main,
                            question.category.sub1
                        );
                        
                        // เลือกหมวดหมู่ย่อย 2
                        document.getElementById('question-sub-category2').value = question.category.sub2 || '';
                    }
                }
            }
            
            // ลบคำถามเดิมจาก Database
            const { error } = await supabaseClient
                .from('questions')
                .delete()
                .eq('id', questionId);
            
            if (error) {
                console.error('เกิดข้อผิดพลาดในการลบคำถามเดิม:', error);
                alert('เกิดข้อผิดพลาดในการแก้ไขคำถาม: ' + error.message);
                return;
            }
            
            // โหลดคำถามใหม่จาก Database
            await loadQuestions();
            
            // อัพเดตการแสดงผล
            displayQuestions();
            
            // เลื่อนไปที่ฟอร์ม
            document.getElementById('question-form').scrollIntoView({ behavior: 'smooth' });
            
            // ตั้งค่า Radio Buttons ใหม่
            setupChoiceRadioButtons();
            
            console.log('เตรียมแก้ไขคำถาม ID:', questionId);
            
        } catch (error) {
            console.error('เกิดข้อผิดพลาดในการแก้ไขคำถาม:', error);
            alert('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล');
        }
    }
}

// ฟังก์ชันสำหรับส่งออกข้อมูลทั้งหมด
function exportAllData() {
    // สร้างอ็อบเจกต์สำหรับส่งออก
    const exportData = {
        categories: categories,
        questions: questions
    };
    
    // แปลงเป็น JSON string
    const jsonString = JSON.stringify(exportData, null, 2);
    
    // สร้าง Blob
    const blob = new Blob([jsonString], { type: 'application/json' });
    
    // สร้าง URL
    const url = URL.createObjectURL(blob);
    
    // สร้าง <a> element สำหรับดาวน์โหลด
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quiz-data.json';
    
    // เพิ่มลงใน document และคลิก
    document.body.appendChild(a);
    a.click();
    
    // ลบออกจาก document
    document.body.removeChild(a);
    
    // เคลียร์ URL
    URL.revokeObjectURL(url);
}

// ฟังก์ชันลบคำถามทั้งหมด - แก้ไขให้ลบใน Database ด้วย
async function clearAllData() {
    if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบคำถามทั้งหมด? การกระทำนี้ไม่สามารถเรียกคืนได้')) {
        try {
            // ลบจาก Supabase Database
            const { error } = await supabaseClient
                .from('questions')
                .delete()
                .neq('id', 0); // ลบทั้งหมด (neq คือ not equal, ใช้เงื่อนไขที่เป็นจริงเสมอ)
            
            if (error) {
                console.error('เกิดข้อผิดพลาดในการลบคำถามทั้งหมด:', error);
                alert('เกิดข้อผิดพลาดในการลบคำถาม: ' + error.message);
                return;
            }
            
            // โหลดคำถามใหม่จาก Database (จะเป็น array ว่าง)
            await loadQuestions();
            
            // อัพเดตการแสดงผล
            displayQuestions();
            
            // อัพเดตตัวเลขแสดงจำนวนคำถามในหมวดหมู่
            renderCategoryTree();
            
            alert('ลบคำถามทั้งหมดเรียบร้อยแล้ว');
            
        } catch (error) {
            console.error('เกิดข้อผิดพลาดที่ไม่คาดคิด:', error);
            alert('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล');
        }
    }
}

// ฟังก์ชันสำหรับดาวน์โหลดเทมเพลต Excel
function downloadExcelTemplate() {
    // สร้างอาเรย์สำหรับข้อมูลตัวอย่าง
    const data = [
        ['คำถาม', 'รูปภาพ (URL)', 'ตัวเลือก A', 'ตัวเลือก B', 'ตัวเลือก C', 'ตัวเลือก D', 'คำตอบที่ถูกต้อง (A, B, C, D)', 'หมวดหมู่หลัก', 'หมวดหมู่ย่อย 1', 'หมวดหมู่ย่อย 2'],
        ['นี่คือตัวอย่างคำถาม?', '', 'ตัวเลือก A', 'ตัวเลือก B', 'ตัวเลือก C', 'ตัวเลือก D', 'A', 'ความรู้ทั่วไป', 'วิทยาศาสตร์', 'ฟิสิกส์']
    ];
    
    // สร้าง workbook
    const wb = XLSX.utils.book_new();
    
    // สร้าง worksheet
    const ws = XLSX.utils.aoa_to_sheet(data);
    
    // กำหนดความกว้างคอลัมน์
    const wscols = [
        {wch: 25}, // คำถาม
        {wch: 20}, // รูปภาพ (URL)
        {wch: 15}, // ตัวเลือก A
        {wch: 15}, // ตัวเลือก B
        {wch: 15}, // ตัวเลือก C
        {wch: 15}, // ตัวเลือก D
        {wch: 25}, // คำตอบที่ถูกต้อง
        {wch: 15}, // หมวดหมู่หลัก
        {wch: 15}, // หมวดหมู่ย่อย 1
        {wch: 15}  // หมวดหมู่ย่อย 2
    ];
    ws['!cols'] = wscols;
    
    // เพิ่ม worksheet ลงใน workbook
    XLSX.utils.book_append_sheet(wb, ws, 'คำถาม');
    
    // สร้างไฟล์ Excel และดาวน์โหลด
    XLSX.writeFile(wb, 'quiz-template.xlsx');
}

// ฟังก์ชันตรวจสอบว่าคำถามซ้ำหรือไม่
function isDuplicateQuestion(questionText) {
    return questions.some(q => q.text.trim().toLowerCase() === questionText.trim().toLowerCase());
}

// ฟังก์ชันสำหรับนำเข้าจาก Excel - แทนที่ฟังก์ชันเดิมทั้งหมด
async function importFromExcel(file) {
    const reader = new FileReader();
    
    reader.onload = async function(e) {
        try {
            // เพิ่มตัวแสดงความคืบหน้า
            const progressDiv = document.createElement('div');
            progressDiv.id = 'import-progress';
            progressDiv.style.cssText = `
                margin: 10px 0;
                padding: 15px;
                background-color: #f0f7ff;
                border-radius: 8px;
                border: 1px solid #1976d2;
                text-align: center;
            `;
            progressDiv.innerHTML = '<p>🔄 กำลังประมวลผลไฟล์ Excel... โปรดรอสักครู่</p>';
            document.getElementById('import-excel').parentNode.appendChild(progressDiv);
            
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true, cellText: false });
            
            // ใช้ชีทแรก
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // แปลงเป็น JSON
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false });
            
            if (jsonData.length === 0) {
                removeProgressDiv();
                alert('ไม่พบข้อมูลในไฟล์ Excel');
                return;
            }
            
            console.log("ข้อมูลที่อ่านได้:", jsonData);
            updateProgressDiv('📊 กำลังตรวจสอบและเตรียมข้อมูล...');
            
            // ขั้นตอนที่ 1: ประมวลผลข้อมูลและตรวจสอบ
            const { validQuestions, errors, newCategoriesToCreate } = await processExcelData(jsonData);
            
            if (validQuestions.length === 0) {
                removeProgressDiv();
                showImportResult(0, errors.length, errors);
                return;
            }
            
            // ขั้นตอนที่ 2: สร้างหมวดหมู่ใหม่ (ถ้ามี)
            updateProgressDiv('📝 กำลังสร้างหมวดหมู่ใหม่...');
            await createNewCategories(newCategoriesToCreate);
            
            // ขั้นตอนที่ 3: บันทึกคำถามแบบ batch
            updateProgressDiv('💾 กำลังบันทึกคำถาม...');
            const { successCount, batchErrors } = await saveQuestionsInBatches(validQuestions);
            
            // รวมข้อผิดพลาดทั้งหมด
            const allErrors = [...errors, ...batchErrors];
            
            // โหลดข้อมูลใหม่
            await loadCategories();
            await loadQuestions();
            
            // อัพเดตการแสดงผล
            renderCategoryTree();
            updateCategoryUI();
            resetFiltersAndDisplay();
            
            // ลบตัวแสดงความคืบหน้า
            removeProgressDiv();
            
            // แสดงผลลัพธ์
            showImportResult(successCount, allErrors.length, allErrors);
            
        } catch (error) {
            console.error("เกิดข้อผิดพลาดในการประมวลผลไฟル์ Excel:", error);
            removeProgressDiv();
            alert(`เกิดข้อผิดพลาดในการประมวลผลไฟล์: ${error.message}`);
        }
    };
    
    reader.onerror = function(error) {
        console.error('เกิดข้อผิดพลาดในการอ่านไฟล์:', error);
        removeProgressDiv();
        alert('เกิดข้อผิดพลาดในการอ่านไฟล์');
    };
    
    reader.readAsArrayBuffer(file);
}

// ฟังก์ชันประมวลผลข้อมูล Excel - เพิ่มใหม่
async function processExcelData(jsonData) {
    const validQuestions = [];
    const errors = [];
    const newCategoriesToCreate = new Set();
    
    // สร้าง map ของชื่อคอลัมน์ที่ยอมรับได้
    const columnMap = {
        'คำถาม': ['คำถาม', 'question', 'text', 'ข้อคำถาม', 'คำถาม?'],
        'รูปภาพ (URL)': ['รูปภาพ (URL)', 'รูปภาพ', 'image', 'url', 'รูป'],
        'ตัวเลือก A': ['ตัวเลือก A', 'ตัวเลือกA', 'choice A', 'choiceA', 'A', 'ตัวเลือก a', 'ตัวเลือกa'],
        'ตัวเลือก B': ['ตัวเลือก B', 'ตัวเลือกB', 'choice B', 'choiceB', 'B', 'ตัวเลือก b', 'ตัวเลือกb'],
        'ตัวเลือก C': ['ตัวเลือก C', 'ตัวเลือกC', 'choice C', 'choiceC', 'C', 'ตัวเลือก c', 'ตัวเลือกc'],
        'ตัวเลือก D': ['ตัวเลือก D', 'ตัวเลือกD', 'choice D', 'choiceD', 'D', 'ตัวเลือก d', 'ตัวเลือกd'],
        'คำตอบที่ถูกต้อง (A, B, C, D)': ['คำตอบที่ถูกต้อง (A, B, C, D)', 'คำตอบที่ถูกต้อง', 'correct answer', 'answer', 'คำตอบ', 'เฉลย'],
        'หมวดหมู่หลัก': ['หมวดหมู่หลัก', 'main category', 'category', 'หมวดหมู่', 'หมวด'],
        'หมวดหมู่ย่อย 1': ['หมวดหมู่ย่อย 1', 'sub category 1', 'subcategory1', 'หมวดหมู่ย่อย1', 'หมวดย่อย 1', 'หมวดย่อย1'],
        'หมวดหมู่ย่อย 2': ['หมวดหมู่ย่อย 2', 'sub category 2', 'subcategory2', 'หมวดหมู่ย่อย2', 'หมวดย่อย 2', 'หมวดย่อย2']
    };
    
    // หา key ในข้อมูลที่ตรงกับชื่อคอลัมน์ที่ต้องการ
    function findColumnKey(row, columnType) {
        const possibleNames = columnMap[columnType];
        for (const name of possibleNames) {
            if (row[name] !== undefined) {
                return name;
            }
        }
        return null;
    }
    
    // สร้างรายการคำถามที่มีอยู่แล้วเพื่อตรวจสอบการซ้ำ
    const existingQuestions = new Set();
    questions.forEach(q => {
        if (q.category) {
            const key = `${q.text.trim().toLowerCase()}|${q.category.main}|${q.category.sub1}|${q.category.sub2}`;
            existingQuestions.add(key);
        }
    });
    
    // ประมวลผลข้อมูลทีละแถว
    for (let index = 0; index < jsonData.length; index++) {
        const row = jsonData[index];
        
        try {
            // แปลงข้อมูลให้เป็นรูปแบบมาตรฐาน
            const formattedRow = {};
            for (const columnType in columnMap) {
                const key = findColumnKey(row, columnType);
                formattedRow[columnType] = key ? String(row[key]).trim() : "";
            }
            
            // ตรวจสอบข้อมูลจำเป็น
            if (!formattedRow['คำถาม']) {
                errors.push(`แถวที่ ${index + 2}: ไม่พบข้อมูลคำถาม`);
                continue;
            }
            
            // ตรวจสอบตัวเลือก
            if (!formattedRow['ตัวเลือก A'] || !formattedRow['ตัวเลือก B'] || 
                !formattedRow['ตัวเลือก C'] || !formattedRow['ตัวเลือก D']) {
                errors.push(`แถวที่ ${index + 2}: ตัวเลือกไม่ครบทั้ง 4 ตัวเลือก`);
                continue;
            }
            
            // ตรวจสอบและแปลงคำตอบที่ถูกต้อง
            let correctAnswer = String(formattedRow['คำตอบที่ถูกต้อง (A, B, C, D)']).trim().toUpperCase();
            if (!correctAnswer) {
                errors.push(`แถวที่ ${index + 2}: ไม่พบข้อมูลคำตอบที่ถูกต้อง`);
                continue;
            }
            
            // รองรับรูปแบบคำตอบที่หลากหลาย
            if (correctAnswer.includes('A') || correctAnswer.includes('1')) correctAnswer = 'A';
            else if (correctAnswer.includes('B') || correctAnswer.includes('2')) correctAnswer = 'B';
            else if (correctAnswer.includes('C') || correctAnswer.includes('3')) correctAnswer = 'C';
            else if (correctAnswer.includes('D') || correctAnswer.includes('4')) correctAnswer = 'D';
            
            if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
                errors.push(`แถวที่ ${index + 2}: รูปแบบคำตอบไม่ถูกต้อง (${correctAnswer})`);
                continue;
            }
            
            // กำหนดหมวดหมู่ (ใช้ค่าเริ่มต้นถ้าไม่มี)
            const mainCategory = formattedRow['หมวดหมู่หลัก'] || 'ทั่วไป';
            const subCategory1 = formattedRow['หมวดหมู่ย่อย 1'] || 'ทั่วไป';
            const subCategory2 = formattedRow['หมวดหมู่ย่อย 2'] || 'ทั่วไป';
            
            // ตรวจสอบคำถามซ้ำ
            const questionKey = `${formattedRow['คำถาม'].toLowerCase()}|${mainCategory}|${subCategory1}|${subCategory2}`;
            if (existingQuestions.has(questionKey)) {
                errors.push(`แถวที่ ${index + 2}: คำถามซ้ำกับที่มีอยู่แล้ว "${formattedRow['คำถาม'].substring(0, 30)}..."`);
                continue;
            }
            
            // เพิ่มเข้าไปในรายการที่ตรวจสอบแล้ว
            existingQuestions.add(questionKey);
            
            // เก็บหมวดหมู่ที่ต้องสร้างใหม่
            if (!categories[mainCategory]) {
                newCategoriesToCreate.add(`main|${mainCategory}`);
            }
            if (!categories[mainCategory] || !categories[mainCategory][subCategory1]) {
                newCategoriesToCreate.add(`sub1|${mainCategory}|${subCategory1}`);
            }
            if (!categories[mainCategory] || !categories[mainCategory][subCategory1] || 
                !categories[mainCategory][subCategory1].includes(subCategory2)) {
                newCategoriesToCreate.add(`sub2|${mainCategory}|${subCategory1}|${subCategory2}`);
            }
            
            // สร้างข้อมูลคำถาม
            const questionData = {
                text: formattedRow['คำถาม'],
                image_url: formattedRow['รูปภาพ (URL)'] || null,
                choices: JSON.stringify([
                    { id: 'A', text: formattedRow['ตัวเลือก A'] },
                    { id: 'B', text: formattedRow['ตัวเลือก B'] },
                    { id: 'C', text: formattedRow['ตัวเลือก C'] },
                    { id: 'D', text: formattedRow['ตัวเลือก D'] }
                ]),
                correct_answer: correctAnswer,
                category_main: mainCategory,
                category_sub1: subCategory1,
                category_sub2: subCategory2
            };
            
            validQuestions.push(questionData);
            
        } catch (err) {
            console.error(`เกิดข้อผิดพลาดในแถวที่ ${index + 2}:`, err);
            errors.push(`แถวที่ ${index + 2}: ${err.message}`);
        }
    }
    
    return { validQuestions, errors, newCategoriesToCreate };
}

// ฟังก์ชันสร้างหมวดหมู่ใหม่ - เพิ่มใหม่
async function createNewCategories(newCategoriesToCreate) {
    if (newCategoriesToCreate.size === 0) return;
    
    const categoriesToInsert = [];
    
    for (const categoryStr of newCategoriesToCreate) {
        const parts = categoryStr.split('|');
        const type = parts[0];
        
        if (type === 'main') {
            categoriesToInsert.push({
                name: parts[1],
                level: 1,
                parent_name: null
            });
        } else if (type === 'sub1') {
            categoriesToInsert.push({
                name: parts[2],
                level: 2,
                parent_name: parts[1]
            });
        } else if (type === 'sub2') {
            categoriesToInsert.push({
                name: parts[3],
                level: 3,
                parent_name: `${parts[1]} > ${parts[2]}`
            });
        }
    }
    
    if (categoriesToInsert.length > 0) {
        const { error } = await supabaseClient
            .from('categories')
            .insert(categoriesToInsert);
        
        if (error) {
            console.error('เกิดข้อผิดพลาดในการสร้างหมวดหมู่:', error);
            throw new Error('ไม่สามารถสร้างหมวดหมู่ใหม่ได้: ' + error.message);
        }
        
        console.log('สร้างหมวดหมู่ใหม่สำเร็จ:', categoriesToInsert.length, 'หมวดหมู่');
    }
}

// ฟังก์ชันบันทึกคำถามแบบ batch - เพิ่มใหม่
async function saveQuestionsInBatches(questions) {
    const BATCH_SIZE = 25;
    let successCount = 0;
    const batchErrors = [];
    
    // แยกคำถามเป็นกลุ่มๆ
    const batches = [];
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
        batches.push(questions.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`กำลังบันทึก ${questions.length} คำถาม เป็น ${batches.length} batch`);
    
    // บันทึกทีละ batch
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNumber = i + 1;
        
        try {
            updateProgressDiv(`💾 กำลังบันทึก batch ${batchNumber}/${batches.length} (${batch.length} ข้อ)...`);
            
            const { data, error } = await supabaseClient
                .from('questions')
                .insert(batch);
            
            if (error) {
                console.error(`Batch ${batchNumber} ผิดพลาด:`, error);
                batchErrors.push(`Batch ${batchNumber} (${batch.length} ข้อ): ${error.message}`);
            } else {
                successCount += batch.length;
                console.log(`Batch ${batchNumber} สำเร็จ: ${batch.length} ข้อ`);
            }
            
        } catch (err) {
            console.error(`เกิดข้อผิดพลาดใน batch ${batchNumber}:`, err);
            batchErrors.push(`Batch ${batchNumber} (${batch.length} ข้อ): ${err.message}`);
        }
    }
    
    return { successCount, batchErrors };
}

// ฟังก์ชันอัพเดตแถบความคืบหน้า - เพิ่มใหม่
function updateProgressDiv(message) {
    const progressDiv = document.getElementById('import-progress');
    if (progressDiv) {
        progressDiv.innerHTML = `<p>${message}</p>`;
    }
}

// ฟังก์ชันลบแถบความคืบหน้า - เพิ่มใหม่
function removeProgressDiv() {
    const progressDiv = document.getElementById('import-progress');
    if (progressDiv) {
        progressDiv.remove();
    }
}

// ฟังก์ชันแสดงผลการนำเข้า - เพิ่มใหม่
function showImportResult(successCount, errorCount, errors) {
    let message = `🎉 การนำเข้าเสร็จสิ้น!\n\n`;
    message += `✅ นำเข้าสำเร็จ: ${successCount} คำถาม\n`;
    message += `❌ ไม่สามารถนำเข้าได้: ${errorCount} รายการ\n`;
    
    if (errorCount > 0 && errors.length > 0) {
        message += `\n📋 รายละเอียดข้อผิดพลาด:\n`;
        const displayErrors = errors.slice(0, 10);
        message += displayErrors.join('\n');
        
        if (errors.length > 10) {
            message += `\n... และอีก ${errors.length - 10} ข้อผิดพลาด`;
        }
    }
    
    alert(message);
}

// ฟังก์ชันสำหรับแสดงรูปภาพคำถาม
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const imagePreview = document.getElementById('image-preview');
            imagePreview.src = e.target.result;
            imagePreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

// เพิ่ม Event Listeners
function setupQuestionSystemEventListeners() {
    // ฟอร์มคำถาม
    const saveQuestionBtn = document.getElementById('save-question');
    if (saveQuestionBtn) {
        saveQuestionBtn.addEventListener('click', saveQuestion);
    }
    
    const clearFormBtn = document.getElementById('clear-form');
    if (clearFormBtn) {
        clearFormBtn.addEventListener('click', clearForm);
    }
    
    const questionImage = document.getElementById('question-image');
    if (questionImage) {
        questionImage.addEventListener('change', handleImageUpload);
    }
    
    // ปุ่มจัดการข้อมูลทั้งหมด
    const exportAllBtn = document.getElementById('export-all');
    if (exportAllBtn) {
        exportAllBtn.addEventListener('click', exportAllData);
    }
    
    const clearAllBtn = document.getElementById('clear-all');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', clearAllData);
    }
    
    const downloadTemplateBtn = document.getElementById('download-template');
    if (downloadTemplateBtn) {
        downloadTemplateBtn.addEventListener('click', downloadExcelTemplate);
    }
    
    // อัพโหลด Excel
    const excelFileInput = document.getElementById('excel-file');
    if (excelFileInput) {
        excelFileInput.addEventListener('change', function(e) {
            if (e.target.files.length > 0) {
                importFromExcel(e.target.files[0]);
            }
        });
    }
    
    const importExcelBtn = document.getElementById('import-excel');
if (importExcelBtn) {
    importExcelBtn.addEventListener('click', function() {
        if (questions.length > 0) {
            if (confirm('มีคำถามอยู่แล้ว การนำเข้าไฟล์ใหม่จะเพิ่มคำถามเข้าไปในรายการเดิม ต้องการดำเนินการต่อหรือไม่?')) {
                document.getElementById('excel-file').click();
            }
        } else {
            document.getElementById('excel-file').click();
        }
    });
}
}
 // ฟังก์ชันเริ่มต้นระบบคำถาม
function initQuestionSystem() {
    console.log("กำลังเริ่มต้นระบบคำถาม...");
    
    // โหลดคำถามจาก localStorage
    loadQuestions();
    
    // ตั้งค่า Event Listeners
    setupQuestionSystemEventListeners();
    
    // ตั้งค่า Event Listeners สำหรับตัวเลือกหมวดหมู่
    setupQuestionCategoryListeners();
    
    // ตั้งค่า Radio Buttons สำหรับตัวเลือกคำตอบ
    setupChoiceRadioButtons();
    
    // อัพเดตการแสดงผลคำถาม - เรียกโดยส่ง isReset เป็น true เพื่อไม่ให้แสดงคำถามทันที
        displayQuestions(false, true);
    
    // แก้ไขระบบบันทึกคำถาม
    updateQuestionSystem();
    
    // อัพเดตตัวเลือกหมวดหมู่ในฟอร์มคำถาม
    updateQuestionCategorySelects();
    
    console.log("ระบบคำถามพร้อมใช้งานแล้ว");
}
// ปรับปรุงระบบเล่นเกม
function updatePlaySystem() {
    console.log("กำลังอัพเดตระบบเล่นเกม...");
    
    // ปุ่มเริ่มเล่น
    const startQuizBtn = document.getElementById('start-quiz');
    if (startQuizBtn) {
        // ลบ event listener เดิม (ถ้ามี)
        const newStartQuizBtn = startQuizBtn.cloneNode(true);
        if (startQuizBtn.parentNode) {
            startQuizBtn.parentNode.replaceChild(newStartQuizBtn, startQuizBtn);
        }
        
        // เพิ่ม event listener ใหม่
        newStartQuizBtn.addEventListener('click', startQuiz);
    }
    
    // ปุ่มเล่นอีกครั้ง
    const restartQuizBtn = document.getElementById('restart-quiz');
    if (restartQuizBtn) {
        // ลบ event listener เดิม (ถ้ามี)
        const newRestartQuizBtn = restartQuizBtn.cloneNode(true);
        if (restartQuizBtn.parentNode) {
            restartQuizBtn.parentNode.replaceChild(newRestartQuizBtn, restartQuizBtn);
        }
        
        // เพิ่ม event listener ใหม่
        newRestartQuizBtn.addEventListener('click', restartQuiz);
    }
    
    // อัพเดตปุ่มต่างๆ ในหน้าเล่นเกม
    const submitAnswerBtn = document.getElementById('submit-answer');
    if (submitAnswerBtn) {
        // ลบ event listener เดิม (ถ้ามี)
        const newSubmitAnswerBtn = submitAnswerBtn.cloneNode(true);
        if (submitAnswerBtn.parentNode) {
            submitAnswerBtn.parentNode.replaceChild(newSubmitAnswerBtn, submitAnswerBtn);
        }
        
        // เพิ่ม event listener ใหม่
        newSubmitAnswerBtn.addEventListener('click', submitAnswer);
    }
    
    const nextQuestionBtn = document.getElementById('next-question');
    if (nextQuestionBtn) {
        // ลบ event listener เดิม (ถ้ามี)
        const newNextQuestionBtn = nextQuestionBtn.cloneNode(true);
        if (nextQuestionBtn.parentNode) {
            nextQuestionBtn.parentNode.replaceChild(newNextQuestionBtn, nextQuestionBtn);
        }
        
        // เพิ่ม event listener ใหม่
        newNextQuestionBtn.addEventListener('click', showNextQuestion);
    }
    
    const prevQuestionBtn = document.getElementById('prev-question');
    if (prevQuestionBtn) {
        // ลบ event listener เดิม (ถ้ามี)
        const newPrevQuestionBtn = prevQuestionBtn.cloneNode(true);
        if (prevQuestionBtn.parentNode) {
            prevQuestionBtn.parentNode.replaceChild(newPrevQuestionBtn, prevQuestionBtn);
        }
        
        // เพิ่ม event listener ใหม่
        newPrevQuestionBtn.addEventListener('click', showPrevQuestion);
    }
    
    console.log("อัพเดตระบบเล่นเกมเรียบร้อยแล้ว");
}

// แทนที่ฟังก์ชัน startQuiz ทั้งหมด
function startQuiz() {
    console.log("กำลังเริ่มเล่นเกม...");
    
    // ตรวจสอบว่ามีคำถามหรือไม่
    if (!Array.isArray(currentGameQuestions) || currentGameQuestions.length === 0) {
        alert('ยังไม่มีคำถามในหมวดหมู่ที่เลือก กรุณาเลือกหมวดหมู่อื่น');
        return;
    }
    
    // ตรวจสอบสิทธิ์การเข้าถึงหมวดหมู่ที่เลือก
    const mainCategory = document.getElementById('play-main-category').value;
    const subCategory1 = document.getElementById('play-sub-category1').value;
    const subCategory2 = document.getElementById('play-sub-category2').value;
    
    if (!canPlayerAccessCategory(mainCategory, subCategory1, subCategory2)) {
        alert('ไม่สามารถเข้าเล่นหมวดหมู่นี้ได้ หมวดหมู่นี้เป็นเนื้อหาพิเศษ');
        return;
    }
    
    console.log("เริ่มเล่นเกม: คำถามทั้งหมด =", currentGameQuestions.length);
    
    // ซ่อนหน้าเลือกหมวดหมู่
    const categorySelectionContainer = document.getElementById('category-selection-container');
    if (categorySelectionContainer) {
        categorySelectionContainer.classList.add('hidden');
    }
    
    // ซ่อนหน้าเริ่มต้น
    const startScreen = document.getElementById('start-screen');
    if (startScreen) startScreen.classList.add('hidden');
    
    // แสดงหน้าเล่นเกม
    const quizScreen = document.getElementById('quiz-screen');
    if (quizScreen) quizScreen.classList.remove('hidden');
    
    // รีเซ็ตการเล่นเกม
    currentQuestionIndex = 0;
    userAnswers = {}; // เคลียร์คำตอบเดิม
    choiceOrderMap = {}; // รีเซ็ตตำแหน่งตัวเลือก
    
    // สร้างลำดับคำถามแบบสุ่ม
    randomQuestionOrder = Array.from(Array(currentGameQuestions.length).keys());
    for (let i = randomQuestionOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [randomQuestionOrder[i], randomQuestionOrder[j]] = [randomQuestionOrder[j], randomQuestionOrder[i]];
    }
    
    // สลับลำดับตัวเลือกสำหรับแต่ละคำถาม
    randomQuestionOrder.forEach(questionIndex => {
        // สร้างลำดับตัวเลือก [0, 1, 2, 3] สำหรับ A, B, C, D
        const choiceOrder = [0, 1, 2, 3];
        
        // สลับลำดับตัวเลือก
        for (let i = choiceOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [choiceOrder[i], choiceOrder[j]] = [choiceOrder[j], choiceOrder[i]];
        }
        
        // บันทึกลำดับตัวเลือกของคำถามนี้
        choiceOrderMap[questionIndex] = choiceOrder;
    });
    
    // เพิ่มส่วนแสดงชื่อผู้เล่นเข้าไปในกรอบเกมที่มุมขวาบน (ไม่มีอวตาร์)
    const quizContainer = document.querySelector('.container.quiz-player');
    if (quizContainer && currentPlayer && !quizContainer.querySelector('.player-info.top-right')) {
        const playerInfo = document.createElement('div');
        playerInfo.className = 'player-info top-right';
        playerInfo.innerHTML = `
            <div class="player-name">ผู้เล่น: ${currentPlayer.name}</div>
        `;
        quizContainer.appendChild(playerInfo);
    }
    
    // อัพเดตหน้าเล่นเกม
    updateQuizScreen();
}

// แทนที่ฟังก์ชัน updateQuizScreen ทั้งหมด
function updateQuizScreen() {
    console.log("กำลังอัพเดตหน้าเล่นเกม...");
    
    // ตรวจสอบว่ามีคำถามหรือไม่
    if (!Array.isArray(currentGameQuestions) || currentGameQuestions.length === 0) {
        console.error("ไม่มีคำถามในระบบ");
        return;
    }
    
    // ตรวจสอบว่ามี elements ที่จำเป็นหรือไม่
    const currentQuestionElement = document.getElementById('current-question');
    const totalQuestionsElement = document.getElementById('total-questions');
    const quizQuestionElement = document.getElementById('quiz-question');
    const quizImageElement = document.getElementById('quiz-image');
    const quizChoicesElement = document.getElementById('quiz-choices');
    
    if (!currentQuestionElement || !totalQuestionsElement || !quizQuestionElement || 
        !quizImageElement || !quizChoicesElement) {
        console.error("ไม่พบ elements ที่จำเป็นสำหรับการแสดงคำถาม");
        return;
    }
    
    // อัพเดตข้อมูลคำถามปัจจุบัน
    currentQuestionElement.textContent = `คำถามที่ ${currentQuestionIndex + 1}`;
    totalQuestionsElement.textContent = currentGameQuestions.length;
    
    // แสดงคำถามปัจจุบัน
    const questionIndex = randomQuestionOrder[currentQuestionIndex];
    const currentQuestion = currentGameQuestions[questionIndex];
    
    quizQuestionElement.textContent = currentQuestion.text;
    
    // แสดงรูปภาพ (ถ้ามี และถ้าเป็น URL ที่ถูกต้อง)
    if (currentQuestion.image && 
        (currentQuestion.image.startsWith('data:') || 
         currentQuestion.image.startsWith('http://') || 
         currentQuestion.image.startsWith('https://'))) {
        quizImageElement.src = currentQuestion.image;
        quizImageElement.classList.remove('hidden');
    } else {
        quizImageElement.src = ''; // รีเซ็ต src ให้ว่างเพื่อไม่ให้แสดงไอคอนรูปแตก
        quizImageElement.classList.add('hidden');
    }
    
    // แสดงตัวเลือก
    quizChoicesElement.innerHTML = '';
    
    // ดึงลำดับตัวเลือกที่สลับไว้
    const choiceOrder = choiceOrderMap[questionIndex] || [0, 1, 2, 3];
    console.log("ลำดับการแสดงตัวเลือกคำถามที่ " + (currentQuestionIndex + 1) + ":", choiceOrder);
    
    // คำตอบที่เลือกไว้
    const userAnswer = userAnswers[questionIndex];
    
    // สร้างตัวเลือกและจัดการการคลิก
    const handleOptionClick = function(selectedId) {
        console.log("เลือกคำตอบ:", selectedId, "สำหรับคำถามที่", currentQuestionIndex);
        
        // ลบคลาส selected จากทุกปุ่ม
        const buttons = quizChoicesElement.querySelectorAll('.option-btn');
        for (let i = 0; i < buttons.length; i++) {
            buttons[i].classList.remove('selected');
        }
        
        // หาปุ่มที่มีข้อมูลตรงกับที่เลือกและเพิ่มคลาส selected
        const targetButton = quizChoicesElement.querySelector(`.option-btn[data-choice-id="${selectedId}"]`);
        if (targetButton) {
            targetButton.classList.add('selected');
        }
        
        // บันทึกคำตอบ
        userAnswers[questionIndex] = selectedId;
        console.log("บันทึกคำตอบ:", userAnswers);
    };
    
    // สร้างตัวเลือกตามลำดับที่สลับไว้
    const choiceLabels = ['A', 'B', 'C', 'D']; // รายการตัวอักษรสำหรับตัวเลือก
    
    choiceOrder.forEach((index, displayIndex) => {
        if (!currentQuestion.choices || !currentQuestion.choices[index]) {
            console.error("ไม่พบข้อมูลตัวเลือกที่", index);
            return;
        }
        
        const choice = currentQuestion.choices[index];
        
        const button = document.createElement('button');
        button.className = 'option-btn';
        button.dataset.choiceId = choice.id; // เก็บ ID ดั้งเดิมไว้เพื่อใช้ในการตรวจคำตอบ
        
        // ตรวจสอบว่าผู้เล่นเลือกตัวเลือกนี้หรือไม่
        if (userAnswer === choice.id) {
            button.classList.add('selected');
        }
        
        // แสดงตัวอักษรตามลำดับการแสดงผล ไม่ใช่ตาม id ดั้งเดิม
        button.innerHTML = `${choiceLabels[displayIndex]}. ${choice.text}`;
        
        // เพิ่ม event listener
        button.onclick = function(e) {
            e.preventDefault(); // ป้องกันพฤติกรรมปกติของปุ่ม
            handleOptionClick(choice.id);
        };
        
        quizChoicesElement.appendChild(button);
    });
    
    // อัพเดตปุ่มนำทาง
    updateNavigationButtons();
    
    console.log("อัพเดตหน้าเล่นเกมเรียบร้อยแล้ว");
}

// อัพเดตปุ่มนำทาง
function updateNavigationButtons() {
    const prevButton = document.getElementById('prev-question');
    const nextButton = document.getElementById('next-question');
    const submitButton = document.getElementById('submit-answer');
    
    // ซ่อน/แสดงปุ่มตามความเหมาะสม
    if (currentQuestionIndex > 0) {
        prevButton.classList.remove('hidden');
    } else {
        prevButton.classList.add('hidden');
    }
    
    if (currentQuestionIndex < currentGameQuestions.length - 1) {
        nextButton.classList.remove('hidden');
    } else {
        nextButton.classList.add('hidden');
    }
    
    // แสดงปุ่มส่งคำตอบเสมอ (ไม่ต้องรอให้เลือกคำตอบ)
    submitButton.classList.remove('hidden');
}
// แทนที่ฟังก์ชัน submitAnswer ทั้งหมด
function submitAnswer() {
    console.log("กำลังตรวจสอบคำตอบ...");
    
    // ตรวจสอบว่ามีคำถามหรือไม่
    if (!Array.isArray(currentGameQuestions) || currentGameQuestions.length === 0) {
        console.error("ไม่มีคำถามในระบบ");
        return;
    }
    
    // บันทึกคำตอบอีกครั้งให้แน่ใจ
    const questionIndex = randomQuestionOrder[currentQuestionIndex];
    const selectedOption = document.querySelector('.option-btn.selected');
    if (selectedOption) {
        userAnswers[questionIndex] = selectedOption.dataset.choiceId;
    }
    
    console.log(`ตอบคำถามข้อที่ ${currentQuestionIndex + 1}/${currentGameQuestions.length}`);
    
    // ถ้าถึงข้อสุดท้ายหรือมีเพียงข้อเดียว
    if (currentGameQuestions.length === 1 || currentQuestionIndex >= currentGameQuestions.length - 1) {
        console.log("ถึงข้อสุดท้ายแล้ว ตรวจสอบว่าตอบครบทุกข้อหรือไม่");
        
        // ตรวจสอบว่าตอบคำถามครบทุกข้อหรือไม่
        const { allAnswered, unansweredQuestions } = checkAllAnswered();
        
        if (!allAnswered) {
            // ถ้ายังตอบไม่ครบ แจ้งเตือนผู้เล่น
            alert(`คุณยังไม่ได้ตอบคำถามข้อที่: ${unansweredQuestions.join(', ')} กรุณาตอบให้ครบทุกข้อ`);
            
            // ไปที่ข้อแรกที่ยังไม่ได้ตอบ
            currentQuestionIndex = unansweredQuestions[0] - 1;
            updateQuizScreen();
        } else {
            // ถ้าตอบครบแล้ว แสดงผลลัพธ์
            showResult();
        }
    } else {
        // มีข้อถัดไป ไปที่ข้อถัดไป
        showNextQuestion();
    }
}

// ฟังก์ชันตรวจสอบว่าตอบครบทุกข้อหรือไม่ก่อนแสดงผลลัพธ์
function checkAllAnsweredAndShowResult() {
    const unansweredQuestions = [];
    
    // ตรวจสอบทุกคำถามว่าได้รับคำตอบหรือไม่
    for (let i = 0; i < randomQuestionOrder.length; i++) {
        const questionIndex = randomQuestionOrder[i];
        if (!userAnswers[questionIndex]) {
            unansweredQuestions.push(i + 1); // เก็บลำดับคำถามที่ยังไม่ได้ตอบ
        }
    }
    
    if (unansweredQuestions.length > 0) {
        // แสดงคำเตือนถ้ายังมีคำถามที่ไม่ได้ตอบ
        let message = 'คุณยังไม่ได้ตอบคำถามบางข้อ:\n';
        message += 'ข้อที่: ' + unansweredQuestions.join(', ');
        message += '\nกรุณาตอบคำถามให้ครบทุกข้อก่อนดูผลลัพธ์';
        alert(message);
        
        // ไปที่คำถามแรกที่ยังไม่ได้ตอบ
        currentQuestionIndex = unansweredQuestions[0] - 1;
        updateQuizScreen();
    } else {
        // ตอบครบทุกข้อแล้ว แสดงผลลัพธ์
        showResult();
    }
}
function showNextQuestion() {
    if (currentQuestionIndex < currentGameQuestions.length - 1) {
        currentQuestionIndex++;
        updateQuizScreen();
    }
}

function showPrevQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        updateQuizScreen();
    }
}

// ฟังก์ชันตรวจสอบว่าตอบครบทุกข้อหรือไม่
function checkAllAnswered() {
    const unansweredQuestions = [];
    
    for (let i = 0; i < randomQuestionOrder.length; i++) {
        const qIndex = randomQuestionOrder[i];
        if (!userAnswers[qIndex]) {
            unansweredQuestions.push(i + 1);
        }
    }
    
    return {
        allAnswered: unansweredQuestions.length === 0,
        unansweredQuestions: unansweredQuestions
    };
}

// แทนที่ฟังก์ชัน showResult ทั้งหมด
function showResult() {
    console.log("กำลังแสดงผลลัพธ์...");
    
    // ตรวจสอบว่ามีคำถามหรือไม่
    if (!Array.isArray(currentGameQuestions) || currentGameQuestions.length === 0) {
        console.error("ไม่มีคำถามในระบบ");
        return;
    }
    
    console.log("แสดงผลลัพธ์: คำถามทั้งหมด =", currentGameQuestions.length);
    console.log("คำตอบของผู้ใช้:", userAnswers);
    
    // ซ่อนหน้าเล่นเกม
    const quizScreen = document.getElementById('quiz-screen');
    if (quizScreen) quizScreen.classList.add('hidden');
    
    // แสดงหน้าผลลัพธ์
    const resultScreen = document.getElementById('result-screen');
    if (!resultScreen) {
        console.error("ไม่พบ element 'result-screen'");
        return;
    }
    
    resultScreen.classList.remove('hidden');
    
    // นับคะแนน
    let correctCount = 0;
    
    // สร้าง HTML สำหรับแสดงคำตอบทั้งหมด
    const questionReview = resultScreen.querySelector('#question-review');
    if (!questionReview) {
        console.error("ไม่พบ element 'question-review'");
        return;
    }
    
    questionReview.innerHTML = '';
    
    // ดึงข้อมูลหมวดหมู่จากคำถามแรก
    const firstQuestion = currentGameQuestions[randomQuestionOrder[0]];
    if (firstQuestion && firstQuestion.category) {
        const categoryInfo = document.createElement('div');
        categoryInfo.className = 'category-summary';
        categoryInfo.innerHTML = `
            <div class="category-title">หมวดหมู่:</div>
            <div class="category-path">${firstQuestion.category.main || 'ไม่ระบุ'} > ${firstQuestion.category.sub1 || 'ไม่ระบุ'} > ${firstQuestion.category.sub2 || 'ไม่ระบุ'}</div>
        `;
        questionReview.appendChild(categoryInfo);
    }
    
    // สร้างรายการคำถามและคำตอบ
    randomQuestionOrder.forEach((questionIndex, index) => {
        const question = currentGameQuestions[questionIndex];
        const userAnswer = userAnswers[questionIndex] || ''; // อาจเป็น undefined ถ้าไม่ได้ตอบ
        const isCorrect = userAnswer === question.correctAnswer;
        
        if (isCorrect) {
            correctCount++;
        }
        
        // สร้าง HTML สำหรับคำถามนี้
        const reviewItem = document.createElement('div');
        reviewItem.className = `question-review-item ${isCorrect ? 'correct' : 'incorrect'}`;
        
        let choicesHTML = '';
        question.choices.forEach(choice => {
            const isUserSelected = choice.id === userAnswer;
            const isCorrectAnswer = choice.id === question.correctAnswer;
            
            let className = 'choice-item';
            if (isUserSelected) className += ' user-selected';
            if (isCorrectAnswer) className += ' correct-answer';
            
            let icon = '';
            if (isUserSelected && isCorrectAnswer) {
                icon = '<span class="choice-icon correct-icon">✓</span>';
            } else if (isUserSelected && !isCorrectAnswer) {
                icon = '<span class="choice-icon incorrect-icon">✗</span>';
            } else if (!isUserSelected && isCorrectAnswer) {
                icon = '<span class="choice-icon correct-icon">✓</span>';
            }
            
            choicesHTML += `
                <div class="${className}">
                    <span class="choice-marker">${choice.id}</span>
                    <span class="choice-text">${choice.text}</span>
                    ${icon}
                </div>
            `;
        });
        
        reviewItem.innerHTML = `
            <div class="question-number">
                <span>ข้อที่ ${index + 1}</span>
                <span class="question-status ${isCorrect ? 'status-correct' : 'status-incorrect'}">
                    ${isCorrect ? 'ตอบถูก' : 'ตอบผิด'}
                </span>
            </div>
            <div class="question-text">${question.text}</div>
            ${question.image ? `<img src="${question.image}" class="question-image">` : ''}
            <div class="choice-list">
                ${choicesHTML}
            </div>
        `;
        
        questionReview.appendChild(reviewItem);
    });
    
    // คำนวณเปอร์เซ็นต์
    const percentage = Math.round((correctCount / currentGameQuestions.length) * 100);
    
    // อัพเดตผลลัพธ์
    const scoreElement = resultScreen.querySelector('#score');
    const maxScoreElement = resultScreen.querySelector('#max-score');
    const percentCorrectElement = resultScreen.querySelector('#percent-correct');
    const correctAnswersElement = resultScreen.querySelector('#correct-answers');
    const incorrectAnswersElement = resultScreen.querySelector('#incorrect-answers');
    const totalQuestionsStatsElement = resultScreen.querySelector('#total-questions-stats');
    
    if (scoreElement) scoreElement.textContent = correctCount;
    if (maxScoreElement) maxScoreElement.textContent = currentGameQuestions.length;
    if (percentCorrectElement) percentCorrectElement.textContent = `${percentage}%`;
    if (correctAnswersElement) correctAnswersElement.textContent = correctCount;
    if (incorrectAnswersElement) incorrectAnswersElement.textContent = currentGameQuestions.length - correctCount;
    if (totalQuestionsStatsElement) totalQuestionsStatsElement.textContent = currentGameQuestions.length;
    
    // บันทึกประวัติการเล่น
    if (currentPlayer) {
        // ดึงหมวดหมู่จากคำถามแรก
        const category = firstQuestion ? firstQuestion.category : null;
        
        // บันทึกประวัติ
        saveUserGameHistory(currentPlayer, correctCount, currentGameQuestions.length, category, percentage);
    }
    
    // อัพเดตการแสดงผลหน้าต่างๆ
    updatePlayScreenVisibility();
    
    console.log("แสดงผลลัพธ์เรียบร้อยแล้ว");
}

// ปุ่มเล่นอีกครั้ง
function restartQuiz() {
    console.log("เริ่มเล่นเกมใหม่...");
    
    // ซ่อนหน้าผลลัพธ์
    const resultScreen = document.getElementById('result-screen');
    if (resultScreen) resultScreen.classList.add('hidden');
    
    // ซ่อนหน้าเล่นเกม
    const quizScreen = document.getElementById('quiz-screen');
    if (quizScreen) quizScreen.classList.add('hidden');
    
    // แสดงหน้าเลือกหมวดหมู่
    const categorySelectionContainer = document.getElementById('category-selection-container');
    if (categorySelectionContainer) {
        categorySelectionContainer.classList.remove('hidden');
    }
    
    // แสดงหน้าเริ่มต้น
    const startScreen = document.getElementById('start-screen');
    if (startScreen) startScreen.classList.remove('hidden');
    
    // รีเซ็ตค่าต่างๆ
    currentQuestionIndex = 0;
    userAnswers = {};
    randomQuestionOrder = [];
    choiceOrderMap = {};
    
    // อัพเดตตัวเลือกหมวดหมู่ในหน้าเล่นเกม (กรณีที่อาจมีหมวดหมู่เพิ่ม/ลบ)
    updatePlayMainCategorySelect();
}

// เริ่มต้นระบบเล่นเกม
function initPlaySystem() {
    updatePlaySystem();
    console.log('ระบบเล่นเกมพร้อมใช้งานแล้ว');
}

// ปรับปรุงระบบเลือกหมวดหมู่ในการเล่นเกม
function updatePlaySystemWithCategories() {
    // หา container ของแท็บเล่นเกม
    const playContent = document.getElementById('play-content');
    if (!playContent) {
        console.error("ไม่พบ element 'play-content'");
        return;
    }

    // หา startScreen ภายใน play-content เท่านั้น
    const startScreen = playContent.querySelector('#start-screen');
    if (startScreen) {
        // ตรวจสอบว่ามี div เลือกหมวดหมู่หรือไม่
        if (!playContent.querySelector('#play-categories')) {
            // สร้าง div สำหรับเลือกหมวดหมู่
            const categoriesDiv = document.createElement('div');
            categoriesDiv.id = 'play-categories';
            categoriesDiv.className = 'category-selection-container';
            
            categoriesDiv.innerHTML = `
                <div class="category-selection-header">
                    <h3>เลือกหมวดหมู่ที่ต้องการเล่น</h3>
                    <p>กรุณาเลือกหมวดหมู่เพื่อเริ่มเล่นเกมตอบคำถาม</p>
                </div>
                
                <div class="category-selection-form">
                    <div class="category-field">
                        <label for="play-main-category">หมวดหมู่หลัก</label>
                        <div class="select-wrapper">
                            <select id="play-main-category" required>
                                <option value="" disabled selected>เลือกหมวดหมู่หลัก</option>
                            </select>
                            <div class="select-arrow"></div>
                        </div>
                    </div>
                    
                    <div class="category-field">
                        <label for="play-sub-category1">หมวดหมู่ย่อย 1</label>
                        <div class="select-wrapper">
                            <select id="play-sub-category1" disabled required>
                                <option value="" disabled selected>เลือกหมวดหมู่ย่อย 1</option>
                            </select>
                            <div class="select-arrow"></div>
                        </div>
                    </div>
                    
                    <div class="category-field">
                        <label for="play-sub-category2">หมวดหมู่ย่อย 2</label>
                        <div class="select-wrapper">
                            <select id="play-sub-category2" disabled required>
                                <option value="" disabled selected>เลือกหมวดหมู่ย่อย 2</option>
                            </select>
                            <div class="select-arrow"></div>
                        </div>
                    </div>
                </div>
            `;

            // ตรวจสอบว่ามีปุ่ม start-quiz หรือไม่
            const startButton = startScreen.querySelector('#start-quiz');
            if (startButton) {
                // เพิ่ม div ก่อนปุ่มเริ่มเล่น แต่อยู่ภายใน startScreen
                startScreen.insertBefore(categoriesDiv, startButton);
            } else {
                // ถ้าไม่พบปุ่ม เพิ่มต่อท้าย
                startScreen.appendChild(categoriesDiv);
            }
            
            // อัพเดตตัวเลือกหมวดหมู่หลัก
            updatePlayMainCategorySelect();
            
            // Event Listener สำหรับการเปลี่ยนหมวดหมู่หลัก
            const playMainCategory = document.getElementById('play-main-category');
            const playSubCategory1 = document.getElementById('play-sub-category1');
            const playSubCategory2 = document.getElementById('play-sub-category2');
            
            if (playMainCategory) {
                playMainCategory.addEventListener('change', function() {
                    const mainCategory = this.value;
                    
                    // รีเซ็ตค่าของ dropdown หมวดย่อย
                    playSubCategory1.value = '';
                    playSubCategory2.value = '';
                    
                    // รีเซ็ตตัวเลือกหมวดย่อย 2
                    playSubCategory2.innerHTML = '<option value="" disabled selected>เลือกหมวดหมู่ย่อย 2</option>';
                    playSubCategory2.disabled = true;
                    
                    if (mainCategory) {
                        updateSubCategory1Select(playSubCategory1, mainCategory);
                    } else {
                        playSubCategory1.innerHTML = '<option value="" disabled selected>เลือกหมวดหมู่ย่อย 1</option>';
                        playSubCategory1.disabled = true;
                    }
                });
            }
            
            if (playSubCategory1) {
                playSubCategory1.addEventListener('change', function() {
                    const mainCategory = playMainCategory.value;
                    const subCategory1 = this.value;
                    
                    // รีเซ็ตค่าของ dropdown หมวดย่อย 2
                    playSubCategory2.value = '';
                    
                    if (mainCategory && subCategory1) {
                        updateSubCategory2Select(playSubCategory2, mainCategory, subCategory1);
                    } else {
                        playSubCategory2.innerHTML = '<option value="" disabled selected>เลือกหมวดหมู่ย่อย 2</option>';
                        playSubCategory2.disabled = true;
                    }
                });
            }
        }
    }
    
    // แก้ไขปุ่มเริ่มเล่น
    const startQuizBtn = playContent.querySelector('#start-quiz');
    if (startQuizBtn) {
        // ดึง event listener เดิมออก (ถ้ามี)
        const newStartQuiz = startQuizBtn.cloneNode(true);
        startQuizBtn.parentNode.replaceChild(newStartQuiz, startQuizBtn);
        
        // เพิ่ม event listener ใหม่
        newStartQuiz.addEventListener('click', function() {
            // ตรวจสอบการเลือกหมวดหมู่
            const mainCategory = document.getElementById('play-main-category').value;
            const subCategory1 = document.getElementById('play-sub-category1').value;
            const subCategory2 = document.getElementById('play-sub-category2').value;
            
            if (!mainCategory) {
                alert('กรุณาเลือกหมวดหมู่หลัก');
                return;
            }
            
            if (!subCategory1) {
                alert('กรุณาเลือกหมวดหมู่ย่อย 1');
                return;
            }
            
            if (!subCategory2) {
                alert('กรุณาเลือกหมวดหมู่ย่อย 2');
                return;
            }
            
            // กรองคำถามตามหมวดหมู่
            currentGameQuestions = questions.filter(q => 
                q.category && 
                q.category.main === mainCategory && 
                q.category.sub1 === subCategory1 && 
                q.category.sub2 === subCategory2
            );
            
            if (currentGameQuestions.length === 0) {
                alert('ไม่พบคำถามในหมวดหมู่ที่เลือก');
                return;
            }
            
            console.log(`พบคำถามในหมวดหมู่ที่เลือก: ${currentGameQuestions.length} ข้อ`);
            
            // เริ่มเล่นเกม
            startQuiz();
        });
    }
}

// แทนที่ฟังก์ชัน updatePlayMainCategorySelect ทั้งหมด
function updatePlayMainCategorySelect() {
    console.log("กำลังอัพเดตตัวเลือกหมวดหมู่หลักในหน้าเล่นเกม...");
    
    const playMainCategory = document.getElementById('play-main-category');
    if (!playMainCategory) {
        console.warn("ไม่พบ element 'play-main-category'");
        return;
    }
    
    // นับคำถามในแต่ละหมวดหมู่
    const categoryCount = countQuestionsInCategory();
    
    // ล้างตัวเลือกเดิม
    playMainCategory.innerHTML = '';
    
    // เพิ่มตัวเลือกเริ่มต้น (placeholder) - ซ่อนจากรายการ
    const placeholderOption = document.createElement('option');
    placeholderOption.value = "";
    placeholderOption.textContent = "เลือกหมวดหมู่หลัก";
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    placeholderOption.style.display = "none"; // ซ่อนจากรายการ dropdown
    playMainCategory.appendChild(placeholderOption);
    
    // เพิ่มหมวดหมู่หลักที่มีอยู่ พร้อมจำนวนคำถาม
    for (const mainCategory in categories) {
        const questionCount = categoryCount[mainCategory] || 0;
        const option = document.createElement('option');
        option.value = mainCategory;
        option.textContent = `${mainCategory} (${questionCount})`;
        playMainCategory.appendChild(option);
    }
    
    // รีเซ็ตตัวเลือกหมวดหมู่ย่อย
    const playSubCategory1 = document.getElementById('play-sub-category1');
    const playSubCategory2 = document.getElementById('play-sub-category2');
    
    if (playSubCategory1) {
        playSubCategory1.innerHTML = '';
        const placeholder1 = document.createElement('option');
        placeholder1.value = "";
        placeholder1.textContent = "เลือกหมวดหมู่ย่อย 1";
        placeholder1.disabled = true;
        placeholder1.selected = true;
        placeholder1.style.display = "none"; // ซ่อนจากรายการ dropdown
        playSubCategory1.appendChild(placeholder1);
        playSubCategory1.disabled = true;
    }
    
    if (playSubCategory2) {
        playSubCategory2.innerHTML = '';
        const placeholder2 = document.createElement('option');
        placeholder2.value = "";
        placeholder2.textContent = "เลือกหมวดหมู่ย่อย 2";
        placeholder2.disabled = true;
        placeholder2.selected = true;
        placeholder2.style.display = "none"; // ซ่อนจากรายการ dropdown
        playSubCategory2.appendChild(placeholder2);
        playSubCategory2.disabled = true;
    }
    
    console.log("อัพเดตตัวเลือกหมวดหมู่หลักในหน้าเล่นเกมเรียบร้อยแล้ว");
}

// แทนที่ฟังก์ชัน enableCategoryPlaySystem ทั้งหมด
function enableCategoryPlaySystem() {
    console.log("กำลังตั้งค่าระบบเล่นเกมให้รองรับหมวดหมู่...");
    
    // อัพเดตตัวเลือกหมวดหมู่ในหน้าเล่นเกม
    updatePlayMainCategorySelect();
    
    // ตั้งค่า event listeners สำหรับตัวเลือกหมวดหมู่
    setupPlayCategoryListeners();
    
    // อัพเดตตัวเลือกหมวดหมู่เมื่อมีการเปลี่ยนแปลงหมวดหมู่
    const oldUpdateCategoryUI = updateCategoryUI;
    updateCategoryUI = function() {
        oldUpdateCategoryUI();
        updatePlayMainCategorySelect();
    };
    
    console.log("ระบบเล่นเกมพร้อมใช้งานแล้ว");
}

// เพิ่มฟังก์ชันใหม่นี้ถัดจาก enableCategoryPlaySystem
function setupPlayCategoryListeners() {
    console.log("กำลังตั้งค่าตัวฟังเหตุการณ์สำหรับตัวเลือกหมวดหมู่ในหน้าเล่นเกม...");
    
    const playMainCategory = document.getElementById('play-main-category');
    const playSubCategory1 = document.getElementById('play-sub-category1');
    const playSubCategory2 = document.getElementById('play-sub-category2');
    
    if (!playMainCategory || !playSubCategory1 || !playSubCategory2) {
        console.warn("ไม่พบ elements ของตัวเลือกหมวดหมู่ในหน้าเล่นเกม");
        return;
    }
    
    // ตั้งค่า event listener สำหรับหมวดหมู่หลัก
    playMainCategory.addEventListener('change', function() {
        const mainCategory = this.value;
        
        // รีเซ็ตค่าของ dropdown หมวดย่อย
        playSubCategory1.value = '';
        playSubCategory2.value = '';
        
        // รีเซ็ตตัวเลือกหมวดย่อย 2
        playSubCategory2.innerHTML = '<option value="" disabled selected>เลือกหมวดหมู่ย่อย 2</option>';
        playSubCategory2.disabled = true;
        
        if (mainCategory) {
            updateSubCategory1Select(playSubCategory1, mainCategory);
        } else {
            playSubCategory1.innerHTML = '<option value="" disabled selected>เลือกหมวดหมู่ย่อย 1</option>';
            playSubCategory1.disabled = true;
        }
    });
    
    // ตั้งค่า event listener สำหรับหมวดหมู่ย่อย 1
    playSubCategory1.addEventListener('change', function() {
        const mainCategory = playMainCategory.value;
        const subCategory1 = this.value;
        
        // รีเซ็ตค่าของ dropdown หมวดย่อย 2
        playSubCategory2.value = '';
        
        if (mainCategory && subCategory1) {
            updateSubCategory2Select(playSubCategory2, mainCategory, subCategory1);
        } else {
            playSubCategory2.innerHTML = '<option value="" disabled selected>เลือกหมวดหมู่ย่อย 2</option>';
            playSubCategory2.disabled = true;
        }
    });
    
    // ตั้งค่า event listener สำหรับปุ่มเริ่มเล่น
    const startQuizBtn = document.getElementById('start-quiz');
    if (startQuizBtn) {
        // ลบ event listeners เดิม (ถ้ามี)
        const newStartQuiz = startQuizBtn.cloneNode(true);
        if (startQuizBtn.parentNode) {
            startQuizBtn.parentNode.replaceChild(newStartQuiz, startQuizBtn);
        }
        
        // เพิ่ม event listener ใหม่
        newStartQuiz.addEventListener('click', function() {
            // ตรวจสอบการเลือกหมวดหมู่
            const mainCategory = document.getElementById('play-main-category').value;
            const subCategory1 = document.getElementById('play-sub-category1').value;
            const subCategory2 = document.getElementById('play-sub-category2').value;
            
            if (!mainCategory) {
                alert('กรุณาเลือกหมวดหมู่หลัก');
                return;
            }
            
            if (!subCategory1) {
                alert('กรุณาเลือกหมวดหมู่ย่อย 1');
                return;
            }
            
            if (!subCategory2) {
                alert('กรุณาเลือกหมวดหมู่ย่อย 2');
                return;
            }
            
            // กรองคำถามตามหมวดหมู่
            currentGameQuestions = questions.filter(q => 
                q.category && 
                q.category.main === mainCategory && 
                q.category.sub1 === subCategory1 && 
                q.category.sub2 === subCategory2
            );
            
            if (currentGameQuestions.length === 0) {
                alert('ไม่พบคำถามในหมวดหมู่ที่เลือก');
                return;
            }
            
            console.log(`พบคำถามในหมวดหมู่ที่เลือก: ${currentGameQuestions.length} ข้อ`);
            
            // เริ่มเล่นเกม
            startQuiz();
        });
    }
    
    console.log("ตั้งค่าตัวฟังเหตุการณ์สำหรับตัวเลือกหมวดหมู่ในหน้าเล่นเกมเรียบร้อยแล้ว");
}

// เพิ่มในส่วน DOMContentLoaded
document.addEventListener('DOMContentLoaded', async function() {
    // เพิ่มคลาส fade-in เพื่อให้เนื้อหาค่อยๆ ปรากฏ
    document.getElementById('play-content').classList.add('fade-in');
    
    // เริ่มต้นแอปพลิเคชัน
    await initializeApp(); // ใหม่
});

function initPlayerSystem() {
    console.log("กำลังเริ่มต้นระบบผู้เล่น...");
    
    // กำหนดค่าเริ่มต้น
    currentPlayer = null;
    userMode = null;
    
    // ตรวจสอบให้แน่ใจว่าไม่ได้อยู่ในโหมดแอดมิน (ยกเว้นกรณีล็อกอินแอดมินจริงๆ)
    if (!adminProfile) {
        isAdminMode = false;
        console.log("รีเซ็ตโหมดแอดมิน: isAdminMode =", isAdminMode);
    }
    
    // *** แก้ไขสำคัญ: ไม่ตรวจสอบ session ทันที แต่แสดงหน้าต้อนรับก่อน ***
    console.log("แสดงหน้าต้อนรับสำหรับผู้ใช้ใหม่");
    showWelcomeScreen();
    
    // อัพเดตแท็บให้ถูกต้องตาม User Type
    updateAdminTabs();
    
    console.log("ระบบผู้เล่นพร้อมใช้งานแล้ว");
}

// ฟังก์ชันแสดงหน้าต้อนรับ
function showWelcomeScreen() {
    const welcomeScreen = document.getElementById('welcome-screen');
    if (welcomeScreen) {
        welcomeScreen.classList.remove('hidden');
        welcomeScreen.style.opacity = '1';
    }
}

// ฟังก์ชันซ่อนหน้าต้อนรับและเริ่มเกม
function hideWelcomeScreenAndStart() {
    hideWelcomeScreen();
    
    // ซ่อนหน้า login เดิม
    const oldLoginScreen = document.getElementById('login-screen');
    if (oldLoginScreen) {
        oldLoginScreen.classList.add('hidden');
    }
    
    // แสดงหน้าเลือกหมวดหมู่
    const startScreen = document.getElementById('start-screen');
    const categorySelection = document.getElementById('category-selection-container');
    
    if (startScreen) startScreen.classList.remove('hidden');
    if (categorySelection) categorySelection.classList.remove('hidden');
    
    // อัพเดต UI
    updateUIForUserMode();
    updatePlayMainCategorySelect();
}

function updateLoginDisplay() {
    console.log("กำลังอัพเดตการแสดงผลหน้าล็อกอิน...");
    
    const loginScreen = document.getElementById('login-screen');
    const startScreen = document.getElementById('start-screen');
    const categorySelectionContainer = document.getElementById('category-selection-container');
    
    if (!loginScreen || !startScreen) {
        console.error("ไม่พบ elements ที่จำเป็น");
        return;
    }
    
    // ตรวจสอบว่าอยู่ในแท็บเล่นเกมหรือไม่
    const playTabActive = document.getElementById('play-tab').classList.contains('active');
    
    if (playTabActive) {
        if (currentPlayer) {
            // ถ้าล็อกอินแล้ว ซ่อนหน้าล็อกอิน แสดงหน้าเริ่มเล่นและหน้าเลือกหมวดหมู่
            loginScreen.classList.add('hidden');
            startScreen.classList.remove('hidden');
            if (categorySelectionContainer) categorySelectionContainer.classList.remove('hidden');
            
            // เพิ่มชื่อผู้เล่นเข้าไปในกรอบเกม
            const quizContainer = document.querySelector('.container.quiz-player');
            if (quizContainer && !quizContainer.querySelector('.player-info.top-right')) {
                const playerInfo = document.createElement('div');
                playerInfo.className = 'player-info top-right';
                playerInfo.innerHTML = `
                    <div class="player-name">ผู้เล่น: ${currentPlayer.name}</div>
                `;
                quizContainer.appendChild(playerInfo);
            }
        } else {
            // ถ้ายังไม่ได้ล็อกอิน แสดงหน้าล็อกอิน ซ่อนหน้าอื่นๆ
            loginScreen.classList.remove('hidden');
            startScreen.classList.add('hidden');
            if (categorySelectionContainer) categorySelectionContainer.classList.add('hidden');
        }
    } else {
        // ซ่อนหน้าล็อกอินเมื่ออยู่ในแท็บอื่น
        loginScreen.classList.add('hidden');
    }
    
    console.log("อัพเดตการแสดงผลหน้าล็อกอินเรียบร้อยแล้ว");
}

// เพิ่มฟังก์ชันนี้ในไฟล์ JavaScript ของคุณ
function updatePlayScreenVisibility() {
    const resultScreen = document.getElementById('result-screen');
    const quizScreen = document.getElementById('quiz-screen');
    const categorySelectionContainer = document.getElementById('category-selection-container');
    const startScreen = document.getElementById('start-screen');
    const loginScreen = document.getElementById('login-screen');
    
    // ถ้าไม่มี element ที่จำเป็น ให้ออกจากฟังก์ชันเลย
    if (!resultScreen || !categorySelectionContainer || !startScreen) {
        console.error("ไม่พบ elements ที่จำเป็นสำหรับการแสดงผลหน้าเล่นเกม");
        return;
    }
    
    // 1. ตรวจสอบสถานะล็อกอิน
    if (!currentPlayer) {
        // ถ้ายังไม่ได้ล็อกอิน
        if (loginScreen) loginScreen.classList.remove('hidden');
        startScreen.classList.add('hidden');
        categorySelectionContainer.classList.add('hidden');
        quizScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        return;
    }
    
    // 2. ถ้าล็อกอินแล้ว ซ่อนหน้าล็อกอิน
    if (loginScreen) loginScreen.classList.add('hidden');
    
    // 3. ตรวจสอบว่ากำลังแสดงผลคะแนนอยู่หรือไม่
    if (!resultScreen.classList.contains('hidden')) {
        // กำลังแสดงผลคะแนนอยู่ ซ่อนหน้าอื่นๆ ทั้งหมด
        startScreen.classList.add('hidden');
        categorySelectionContainer.classList.add('hidden');
        quizScreen.classList.add('hidden');
    } else if (!quizScreen.classList.contains('hidden')) {
        // กำลังเล่นเกมอยู่ ซ่อนหน้าอื่นๆ
        startScreen.classList.add('hidden');
        categorySelectionContainer.classList.add('hidden');
        resultScreen.classList.add('hidden');
    } else {
        // ไม่ได้เล่นเกมและไม่ได้แสดงผลคะแนน แสดงหน้าเริ่มเล่นและเลือกหมวดหมู่
        startScreen.classList.remove('hidden');
        categorySelectionContainer.classList.remove('hidden');
        resultScreen.classList.add('hidden');
        quizScreen.classList.add('hidden');
    }
}

async function loginPlayer() {
    const playerNameInput = document.getElementById('player-name');
    const rememberPlayer = document.getElementById('remember-player');
    
    if (!playerNameInput) {
        console.error("ไม่พบ element 'player-name'");
        return;
    }
    
    // ตรวจสอบว่ามีการกรอกชื่อผู้เล่นหรือไม่
    const playerName = playerNameInput.value.trim();
    if (!playerName) {
        alert('กรุณากรอกชื่อผู้เล่น');
        return;
    }

    // ตรวจสอบว่าเป็นการเข้าสู่โหมดแอดมินหรือไม่
    if (playerName.toLowerCase() === 'admin') {
        showAdminLoginForm();
        return;
    }
    
    // ป้องกันการใช้ชื่อ admin
    if (playerName.toLowerCase().includes('admin')) {
        alert('ไม่สามารถใช้ชื่อที่มีคำว่า "admin" ได้ กรุณาเลือกชื่ออื่น');
        return;
    }
    
    try {
        // *** การป้องกันใหม่: Clear session admin ก่อนล็อกอินผู้เล่นธรรมดา ***
        console.log("🔄 กำลัง clear admin session ก่อนล็อกอินผู้เล่น...");
        await supabaseClient.auth.signOut();
        console.log("✅ Clear admin session สำเร็จ");
    } catch (error) {
        console.log("ℹ️ ไม่มี admin session ที่ต้อง clear:", error.message);
    }
    
    // รอให้ signOut เสร็จสิ้นก่อนดำเนินการต่อ
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // *** สำคัญ: บังคับให้เป็นผู้เล่นธรรมดา ***
    isAdminMode = false;
    currentUser = null;
    adminProfile = null;
    
    // ล็อกอินผู้เล่นธรรมดา
    currentPlayer = {
        name: playerName,
        loginTime: new Date().toISOString(),
        avatar: getPlayerInitials(playerName),
        isGuest: true // เพิ่มการระบุว่าเป็น Guest
    };
    
    console.log("🎮 ล็อกอินผู้เล่นธรรมดา:", playerName);
    console.log("🔒 isAdminMode:", isAdminMode, "adminProfile:", adminProfile);
    
    // บันทึกชื่อผู้เล่นลงใน localStorage ถ้าเลือก "จำชื่อของฉัน"
    if (rememberPlayer && rememberPlayer.checked) {
        localStorage.setItem('quiz-player-name', playerName);
    } else if (rememberPlayer && !rememberPlayer.checked) {
        localStorage.removeItem('quiz-player-name');
    }
    
    // ซ่อนหน้าล็อกอินและแสดงหน้าเริ่มเกม
    const loginScreen = document.getElementById('login-screen');
    const startScreen = document.getElementById('start-screen');
    const categorySelectionContainer = document.getElementById('category-selection-container');
    
    if (loginScreen) loginScreen.classList.add('hidden');
    if (startScreen) startScreen.classList.remove('hidden');
    if (categorySelectionContainer) categorySelectionContainer.classList.remove('hidden');
    
    // เพิ่มส่วนแสดงชื่อผู้เล่นเข้าไปในกรอบเกมที่มุมขวาบน
    const quizContainer = document.querySelector('.container.quiz-player');
    if (quizContainer && !quizContainer.querySelector('.player-info.top-right')) {
        const playerInfo = document.createElement('div');
        playerInfo.className = 'player-info top-right';
        playerInfo.innerHTML = `
            <div class="player-name">ผู้เล่น: ${currentPlayer.name}</div>
        `;
        quizContainer.appendChild(playerInfo);
    }
    
    // อัพเดตการแสดงผลหน้าต่างๆ
    updateLoginDisplay();
    
    // อัพเดตแท็บให้เป็นผู้เล่นธรรมดา
    updateAdminTabs();
    
    // อัพเดตตัวเลือกหมวดหมู่ในหน้าเล่นเกม
    updatePlayMainCategorySelect();
}

// ฟังก์ชันแสดงฟอร์มล็อกอินแอดมิน
function showAdminLoginForm() {
    // ลบฟอร์มเก่า (ถ้ามี)
    const existingForm = document.getElementById('admin-login-overlay');
    if (existingForm) {
        existingForm.remove();
    }
    
    // สร้างฟอร์มล็อกอินแอดมิน
    const overlay = document.createElement('div');
    overlay.id = 'admin-login-overlay';
    overlay.className = 'admin-password-overlay';
    
    overlay.innerHTML = `
        <div class="admin-password-modal">
            <div class="admin-password-header">
                <h3>🔐 ล็อกอินแอดมิน</h3>
                <button class="close-btn" onclick="closeAdminLoginForm()">×</button>
            </div>
            <div class="admin-password-body">
                <div style="margin-bottom: 15px;">
                    <label for="admin-email-input">อีเมล:</label>
                    <input type="email" id="admin-email-input" class="admin-password-input" placeholder="admin@yoursite.com">
                </div>
                <div style="margin-bottom: 15px;">
                    <label for="admin-password-input">รหัสผ่าน:</label>
                    <input type="password" id="admin-password-input" class="admin-password-input" placeholder="ใส่รหัสผ่านที่นี่">
                </div>
                <div class="admin-password-error" id="admin-login-error" style="display: none;">
                    ❌ อีเมลหรือรหัสผ่านไม่ถูกต้อง
                </div>
            </div>
            <div class="admin-password-actions">
                <button class="admin-password-confirm" onclick="submitAdminLogin()">เข้าสู่ระบบ</button>
                <button class="admin-password-cancel" onclick="closeAdminLoginForm()">ยกเลิก</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    // โฟกัสที่ input อีเมล
    setTimeout(() => {
        const emailInput = document.getElementById('admin-email-input');
        if (emailInput) {
            emailInput.focus();
            
            // รองรับการกด Enter
            emailInput.addEventListener('keyup', function(e) {
                if (e.key === 'Enter') {
                    document.getElementById('admin-password-input').focus();
                }
            });
            
            document.getElementById('admin-password-input').addEventListener('keyup', function(e) {
                if (e.key === 'Enter') {
                    submitAdminLogin();
                }
            });
        }
    }, 100);
    
    // ป้องกัน scroll
    document.body.style.overflow = 'hidden';
}

// ฟังก์ชันปิดฟอร์มล็อกอินแอดมิน
function closeAdminLoginForm() {
    const overlay = document.getElementById('admin-login-overlay');
    if (overlay) {
        overlay.remove();
    }
    document.body.style.overflow = '';
    
    // ล้างค่าในช่องชื่อผู้เล่น
    const playerNameInput = document.getElementById('player-name');
    if (playerNameInput) {
        playerNameInput.value = '';
    }
}

// ฟังก์ชันส่งข้อมูลล็อกอินแอดมิน
async function submitAdminLogin() {
    const emailInput = document.getElementById('admin-email-input');
    const passwordInput = document.getElementById('admin-password-input');
    const errorDiv = document.getElementById('admin-login-error');
    
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    
    if (!email || !password) {
        alert('กรุณากรอกอีเมลและรหัสผ่าน');
        return;
    }
    
    // แสดง loading
    const confirmBtn = document.querySelector('.admin-password-confirm');
    const originalText = confirmBtn.textContent;
    confirmBtn.textContent = 'กำลังตรวจสอบ...';
    confirmBtn.disabled = true;
    
    // ลองล็อกอิน
    const success = await loginAdmin(email, password);
    
    if (success) {
        // ล็อกอินสำเร็จ
        closeAdminLoginForm();
        
        // ซ่อนหน้าล็อกอินหลัก
        const loginScreen = document.getElementById('login-screen');
        if (loginScreen) loginScreen.classList.add('hidden');
        
        alert('ยินดีต้อนรับสู่ระบบแอดมิน! 👑');
        
    } else {
        // ล็อกอินไม่สำเร็จ
        errorDiv.style.display = 'block';
        passwordInput.value = '';
        passwordInput.focus();
        
        // เขย่า modal
        const modal = document.querySelector('.admin-password-modal');
        if (modal) {
            modal.classList.add('shake');
            setTimeout(() => {
                modal.classList.remove('shake');
            }, 500);
        }
        
        // ซ่อนข้อผิดพลาดหลัง 3 วินาที
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 3000);
    }
    
    // คืนค่าปุ่ม
    confirmBtn.textContent = originalText;
    confirmBtn.disabled = false;
}

// ฟังก์ชันสุ่มไอคอนน่ารักๆ สำหรับผู้เล่น
function getPlayerInitials(name) {
    // รายการไอคอนน่ารักๆ
    const icons = [
        '🎮', '🎯', '🧠', '🎓', '🌟', '🏆', '📚', '😊', 
        '🚀', '🎨', '🔍', '💡', '🎪', '🎭', '🎬', '🎧',
        '🌈', '🦄', '🐱', '🐶', '🦊', '🦁', '🐼', '🐰'
    ];
    
    // ถ้าไม่มีชื่อ ให้ใช้เครื่องหมายคำถาม
    if (!name) return '?';
    
    // สุ่มไอคอนจากชื่อ (ใช้ชื่อเป็น seed ให้ได้ไอคอนเดิมทุกครั้ง)
    let sum = 0;
    for (let i = 0; i < name.length; i++) {
        sum += name.charCodeAt(i);
    }
    
    // ใช้ผลรวมของรหัส ASCII ในชื่อเป็นดัชนีสำหรับเลือกไอคอน
    const index = sum % icons.length;
    return icons[index];
}

// ฟังก์ชันอัพเดตการแสดงผลคำถามในรูปแบบใหม่
function displayQuestionsEnhanced(filtered = false) {
    const questionsContainer = document.getElementById('questions-container');
    const questionCount = document.getElementById('question-count');
    
    // ตรวจสอบว่ามีการเลือกตัวกรองหรือไม่
    const filterMainCategory = document.getElementById('filter-main-category');
    const mainCategoryValue = filterMainCategory ? filterMainCategory.value : '';
    
    // ตรวจสอบว่าเลือก "แสดงคำถามทั้งหมด" หรือไม่
    const showAllQuestions = mainCategoryValue === 'all';
    
    // ตรวจสอบว่ามีการค้นหาหรือไม่
    const searchInput = document.getElementById('search-questions');
    const hasSearch = searchInput && searchInput.value.trim() !== '';
    
    // มีการกรองถ้า filtered=true หรือถ้ามีการเลือกหมวดหมู่หรือค้นหา
    const filterSelected = filtered || showAllQuestions || hasSearch;
    
    if (questionsContainer) {
        questionsContainer.innerHTML = '';
        
        // ถ้าไม่มีคำถาม
        if (questions.length === 0) {
            questionsContainer.innerHTML = `
                <div class="empty-state">
                    <p>ยังไม่มีคำถามที่บันทึกไว้</p>
                    <p>เริ่มสร้างคำถามใหม่เลย!</p>
                </div>
            `;
        } 
        // ถ้าไม่ได้เลือกตัวกรอง (หรือเป็นตัวเลือกเริ่มต้น)
        else if (!filterSelected && mainCategoryValue === '') {
            questionsContainer.innerHTML = `
                <div class="empty-state">
                    <p>กรุณาเลือกหมวดหมู่เพื่อแสดงคำถาม</p>
                    <p>หรือเลือก "แสดงคำถามทั้งหมด" เพื่อดูคำถามทั้งหมด ${questions.length} ข้อ</p>
                </div>
            `;
        }
        // แสดงคำถามตามตัวกรอง
        else {
            questions.forEach((question, index) => {
                const questionCard = document.createElement('div');
                questionCard.className = 'question-card';
                
                let choicesHTML = '<div class="choices">';
                question.choices.forEach(choice => {
                    const isCorrect = choice.id === question.correctAnswer;
                    choicesHTML += `
                        <div class="choice ${isCorrect ? 'correct' : ''}">
                            ${choice.id}: ${choice.text}
                        </div>
                    `;
                });
                choicesHTML += '</div>';
                
                let categoryText = `
                    <div class="question-category">
                        <strong>หมวดหมู่:</strong> 
                        ${question.category?.main || 'ไม่ระบุ'} > 
                        ${question.category?.sub1 || 'ไม่ระบุ'} > 
                        ${question.category?.sub2 || 'ไม่ระบุ'}
                    </div>
                `;
                
                questionCard.innerHTML = `
                    <h3>คำถามที่ ${index + 1}: ${question.text}</h3>
                    ${question.image ? `<img src="${question.image}" class="question-image">` : ''}
                    ${choicesHTML}
                    ${categoryText}
                    <div class="question-actions">
                        <button class="action-btn edit-btn" onclick="editQuestion('${question.id}')">แก้ไข</button>
                        <button class="action-btn delete-btn" onclick="deleteQuestion('${question.id}')">ลบ</button>
                    </div>
                `;
                
                questionsContainer.appendChild(questionCard);
            });
        }
        
        // อัพเดตจำนวนคำถาม
        if (questionCount) {
            questionCount.textContent = questions.length;
        }
    }
}
// เพิ่มฟังก์ชันช่วยแสดงทุกคำถาม
function displayAllQuestions(container) {
    questions.forEach((question, index) => {
        container.appendChild(createQuestionCard(question, index));
    });
}

// เพิ่มฟังก์ชันช่วยแสดงคำถามที่กรองแล้ว
function displayFilteredQuestions(container) {
    questions.forEach((question, index) => {
        container.appendChild(createQuestionCard(question, index));
    });
}

// ฟังก์ชันช่วยสร้างการ์ดคำถาม (แยกออกมาเพื่อลดการทำซ้ำ)
function createQuestionCard(question, index) {
    const questionCard = document.createElement('div');
    questionCard.className = 'question-card';
    
    let choicesHTML = '<div class="choices">';
    question.choices.forEach(choice => {
        const isCorrect = choice.id === question.correctAnswer;
        choicesHTML += `
            <div class="choice ${isCorrect ? 'correct' : ''}">
                ${choice.id}: ${choice.text}
            </div>
        `;
    });
    choicesHTML += '</div>';
    
    let categoryText = `
        <div class="question-category">
            <strong>หมวดหมู่:</strong> 
            ${question.category?.main || 'ไม่ระบุ'} > 
            ${question.category?.sub1 || 'ไม่ระบุ'} > 
            ${question.category?.sub2 || 'ไม่ระบุ'}
        </div>
    `;
    
    questionCard.innerHTML = `
        <h3>คำถามที่ ${index + 1}: ${question.text}</h3>
        ${question.image ? `<img src="${question.image}" class="question-image">` : ''}
        ${choicesHTML}
        ${categoryText}
        <div class="question-actions">
            <button class="action-btn edit-btn" onclick="editQuestion('${question.id}')">แก้ไข</button>
            <button class="action-btn delete-btn" onclick="deleteQuestion('${question.id}')">ลบ</button>
        </div>
    `;
    
    return questionCard;
}

// ฟังก์ชันตั้งค่าระบบค้นหาคำถาม
function setupSearchQuestions() {
    const searchInput = document.getElementById('search-questions');
    if (searchInput) {
        // ล้าง event handler เดิม (ถ้ามี)
        const newSearchInput = searchInput.cloneNode(true);
        if (searchInput.parentNode) {
            searchInput.parentNode.replaceChild(newSearchInput, searchInput);
        }
        
        // เพิ่ม event handler ใหม่ - ใช้ตัวหน่วงเวลาเพื่อไม่ให้ค้นหาทุกครั้งที่พิมพ์
        let searchTimeout = null;
        newSearchInput.addEventListener('input', function() {
            // ยกเลิกตัวหน่วงเวลาเดิม (ถ้ามี)
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            
            // สร้างตัวหน่วงเวลาใหม่ - ค้นหาหลังจากพิมพ์เสร็จ 300ms
            searchTimeout = setTimeout(() => {
                applyFilters();
                searchTimeout = null;
            }, 300);
        });
    }
}
// เพิ่ม event listener หลังจากที่หน้าเว็บโหลดเสร็จ
document.addEventListener('DOMContentLoaded', function() {
    // ตั้งค่าระบบค้นหา
    setupSearchQuestions();
});

// ฟังก์ชันตั้งค่าตัวกรองหมวดหมู่
function setupCategoryFilter() {
    // อัพเดตโครงสร้าง HTML สำหรับส่วนกรอง
    const questionFilters = document.querySelector('.question-filters');
    if (questionFilters) {
        // เพิ่มส่วนตัวกรองหมวดหมู่
        const categoryFilter = document.createElement('div');
        categoryFilter.className = 'category-filter-container';
        categoryFilter.innerHTML = `
            <div class="filter-group">
                <select id="filter-main-category" class="filter-select">
                    <option value="">ทุกหมวดหมู่หลัก</option>
                </select>
            </div>
            <div class="filter-group">
                <select id="filter-sub-category1" class="filter-select" disabled>
                    <option value="">ทุกหมวดหมู่ย่อย 1</option>
                </select>
            </div>
            <div class="filter-group">
                <select id="filter-sub-category2" class="filter-select" disabled>
                    <option value="">ทุกหมวดหมู่ย่อย 2</option>
                </select>
            </div>
            <button id="reset-filters" class="filter-btn">รีเซ็ตตัวกรอง</button>
        `;
        
        questionFilters.appendChild(categoryFilter);
        
        // เพิ่มตัวเลือกหมวดหมู่หลัก
        const filterMainCategory = document.getElementById('filter-main-category');
        const filterSubCategory1 = document.getElementById('filter-sub-category1');
        const filterSubCategory2 = document.getElementById('filter-sub-category2');
        
        // อัพเดตตัวเลือกหมวดหมู่หลัก
        updateFilterMainCategory();
        
        // Event Listeners สำหรับการเปลี่ยนหมวดหมู่ - ส่วนที่มีการเปลี่ยนแปลง
        filterMainCategory.addEventListener('change', function() {
            const mainCategory = this.value;
            
            // รีเซ็ตค่าของ dropdown หมวดย่อย
            filterSubCategory1.value = '';
            filterSubCategory2.value = '';
            
            // รีเซ็ตหมวดหมู่ย่อย
            filterSubCategory1.innerHTML = '<option value="">ทุกหมวดหมู่ย่อย 1</option>';
            filterSubCategory2.innerHTML = '<option value="">ทุกหมวดหมู่ย่อย 2</option>';
            filterSubCategory2.disabled = true;
            
            if (mainCategory) {
                // อัพเดตตัวเลือกหมวดหมู่ย่อย 1
                updateFilterSubCategory1(mainCategory);
                filterSubCategory1.disabled = false;
            } else {
                filterSubCategory1.disabled = true;
            }
            
            // ใช้ตัวกรองปัจจุบัน - เรียกใช้ฟังก์ชันกรองที่ปรับปรุงแล้ว
            applyFilters();
        });
        
        filterSubCategory1.addEventListener('change', function() {
            const mainCategory = filterMainCategory.value;
            const subCategory1 = this.value;
            
            // รีเซ็ตค่าของ dropdown หมวดย่อย 2
            filterSubCategory2.value = '';
            
            // รีเซ็ตหมวดหมู่ย่อย 2
            filterSubCategory2.innerHTML = '<option value="">ทุกหมวดหมู่ย่อย 2</option>';
            
            if (mainCategory && subCategory1) {
                // อัพเดตตัวเลือกหมวดหมู่ย่อย 2
                updateFilterSubCategory2(mainCategory, subCategory1);
                filterSubCategory2.disabled = false;
            } else {
                filterSubCategory2.disabled = true;
            }
            
            // ใช้ตัวกรองปัจจุบัน - เรียกใช้ฟังก์ชันกรองที่ปรับปรุงแล้ว
            applyFilters();
        });
        
        filterSubCategory2.addEventListener('change', function() {
            // ใช้ตัวกรองปัจจุบัน - เรียกใช้ฟังก์ชันกรองที่ปรับปรุงแล้ว
            applyFilters();
        });
        
        // ปุ่มรีเซ็ตตัวกรอง
const resetFiltersBtn = document.getElementById('reset-filters');
if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', function() {
        // รีเซ็ตตัวเลือกทั้งหมด
        filterMainCategory.value = '';
        filterSubCategory1.innerHTML = '<option value="">ทุกหมวดหมู่ย่อย 1</option>';
        filterSubCategory2.innerHTML = '<option value="">ทุกหมวดหมู่ย่อย 2</option>';
        filterSubCategory1.disabled = true;
        filterSubCategory2.disabled = true;
        
        // รีเซ็ตการค้นหา
        const searchInput = document.getElementById('search-questions');
        if (searchInput) {
            searchInput.value = '';
        }
        
        // แสดงคำถาม - ส่ง true เพื่อบอกว่าเป็นการรีเซ็ต
        displayQuestions(false, true);
    });
}
    }
}

// ฟังก์ชันอัพเดตตัวเลือกหมวดหมู่หลักสำหรับตัวกรอง
function updateFilterMainCategory() {
    const filterMainCategory = document.getElementById('filter-main-category');
    if (filterMainCategory) {
        // ล้างตัวเลือกเดิม
        filterMainCategory.innerHTML = '';
        
        // เพิ่มตัวเลือกเริ่มต้น (placeholder) ที่ไม่แสดงคำถามใดๆ
        const placeholderOption = document.createElement('option');
        placeholderOption.value = "";
        placeholderOption.textContent = "กรุณาเลือกหมวดหมู่";
        placeholderOption.selected = true;
        placeholderOption.disabled = true;
        filterMainCategory.appendChild(placeholderOption);
        
        // เพิ่มตัวเลือก "แสดงคำถามทั้งหมด"
        const allQuestionsOption = document.createElement('option');
        allQuestionsOption.value = "all";
        allQuestionsOption.textContent = "แสดงคำถามทั้งหมด";
        filterMainCategory.appendChild(allQuestionsOption);
        
        // เพิ่มหมวดหมู่หลักที่มีอยู่
        for (const mainCategory in categories) {
            const option = document.createElement('option');
            option.value = mainCategory;
            option.textContent = mainCategory;
            filterMainCategory.appendChild(option);
        }
    }
}

// ฟังก์ชันอัพเดตตัวเลือกหมวดหมู่ย่อย 1 สำหรับตัวกรอง
function updateFilterSubCategory1(mainCategory) {
    const filterSubCategory1 = document.getElementById('filter-sub-category1');
    if (filterSubCategory1 && mainCategory) {
        // เก็บตัวเลือกแรกไว้
        const firstOption = filterSubCategory1.options[0];
        filterSubCategory1.innerHTML = '';
        filterSubCategory1.appendChild(firstOption);
        
        // เพิ่มหมวดหมู่ย่อย 1 ที่มีอยู่
        if (categories[mainCategory]) {
            for (const subCategory1 in categories[mainCategory]) {
                const option = document.createElement('option');
                option.value = subCategory1;
                option.textContent = subCategory1;
                filterSubCategory1.appendChild(option);
            }
        }
    }
}

// ฟังก์ชันอัพเดตตัวเลือกหมวดหมู่ย่อย 2 สำหรับตัวกรอง
function updateFilterSubCategory2(mainCategory, subCategory1) {
    const filterSubCategory2 = document.getElementById('filter-sub-category2');
    if (filterSubCategory2 && mainCategory && subCategory1) {
        // เก็บตัวเลือกแรกไว้
        const firstOption = filterSubCategory2.options[0];
        filterSubCategory2.innerHTML = '';
        filterSubCategory2.appendChild(firstOption);
        
        // เพิ่มหมวดหมู่ย่อย 2 ที่มีอยู่
        if (categories[mainCategory] && categories[mainCategory][subCategory1]) {
            for (const subCategory2Item of categories[mainCategory][subCategory1]) {
                const option = document.createElement('option');
                
                // ตรวจสอบว่าเป็น object หรือ string
                if (typeof subCategory2Item === 'object' && subCategory2Item.name) {
                    // กรณีที่เป็น object ใหม่
                    option.value = subCategory2Item.name;
                    option.textContent = subCategory2Item.name;
                } else {
                    // กรณีที่เป็น string เก่า (backward compatibility)
                    option.value = subCategory2Item;
                    option.textContent = subCategory2Item;
                }
                
                filterSubCategory2.appendChild(option);
            }
        }
    }
}

// นำไปแทนที่ฟังก์ชัน applyFilters ทั้งหมด
function applyFilters(isReset = false) {
    const searchInput = document.getElementById('search-questions');
    const filterMainCategory = document.getElementById('filter-main-category');
    const filterSubCategory1 = document.getElementById('filter-sub-category1');
    const filterSubCategory2 = document.getElementById('filter-sub-category2');
    
    // ถ้าเป็นการรีเซ็ต ส่งอาเรย์ว่างไปแสดงผล
    if (isReset) {
        displayFilteredQuestions([], true, true);
        return;
    }
    
    // ดึงค่าตัวกรอง
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const mainCategory = filterMainCategory ? filterMainCategory.value : '';
    const subCategory1 = filterSubCategory1 ? filterSubCategory1.value : '';
    const subCategory2 = filterSubCategory2 ? filterSubCategory2.value : '';
    
    // กรองคำถามโดยไม่แก้ไขอาเรย์ questions เดิม
    let filteredQuestions = questions.filter(question => {
        // กรองตามคำค้นหา
        const matchesSearch = searchTerm === '' || 
            question.text.toLowerCase().includes(searchTerm) || 
            question.choices.some(choice => choice.text.toLowerCase().includes(searchTerm)) ||
            (question.category?.main && question.category.main.toLowerCase().includes(searchTerm)) ||
            (question.category?.sub1 && question.category.sub1.toLowerCase().includes(searchTerm)) ||
            (question.category?.sub2 && question.category.sub2.toLowerCase().includes(searchTerm));
        
        // ถ้าเลือก "แสดงคำถามทั้งหมด" ให้แสดงคำถามทั้งหมด
        if (mainCategory === 'all') {
            return matchesSearch; // แสดงทุกคำถามที่ตรงกับคำค้นหา
        }
        
        // ถ้าไม่ได้เลือกหมวดหมู่ (ค่าเริ่มต้น) ไม่แสดงคำถาม
        if (mainCategory === '') {
            return false;
        }
        
        // กรองตามหมวดหมู่
        const matchesMainCategory = question.category?.main && question.category.main === mainCategory;
        const matchesSubCategory1 = subCategory1 === '' || 
            (question.category?.sub1 && question.category.sub1 === subCategory1);
        const matchesSubCategory2 = subCategory2 === '' || 
            (question.category?.sub2 && question.category.sub2 === subCategory2);
        
        return matchesSearch && matchesMainCategory && matchesSubCategory1 && matchesSubCategory2;
    });
    
    // แสดงคำถามที่กรองแล้ว
    displayFilteredQuestions(filteredQuestions, true);
}

// นำไปแทนที่ฟังก์ชัน displayFilteredQuestions ทั้งหมด
function displayFilteredQuestions(filteredQuestions, filtered = true, isReset = false) {
    const questionsContainer = document.getElementById('questions-container');
    const questionCount = document.getElementById('question-count');
    
    if (questionsContainer) {
        questionsContainer.innerHTML = '';
        
        // กรณีรีเซ็ตตัวกรอง
        if (isReset) {
            questionsContainer.innerHTML = `
                <div class="empty-state">
                    <p>กรุณาเลือกหมวดหมู่เพื่อแสดงคำถาม</p>
                    <p>หรือเลือก "แสดงคำถามทั้งหมด" เพื่อดูคำถามทั้งหมด ${questions.length} ข้อ</p>
                </div>
            `;
        }
        // ถ้าไม่มีคำถามหรือไม่มีคำถามที่ตรงตามเงื่อนไข
        else if (filteredQuestions.length === 0) {
            if (filtered) {
                questionsContainer.innerHTML = `
                    <div class="empty-state">
                        <p>ไม่พบคำถามที่ตรงตามเงื่อนไขการค้นหาหรือตัวกรอง</p>
                        <p>กรุณาลองเปลี่ยนคำค้นหาหรือเงื่อนไขตัวกรอง</p>
                    </div>
                `;
            } else {
                questionsContainer.innerHTML = `
                    <div class="empty-state">
                        <p>ยังไม่มีคำถามที่บันทึกไว้</p>
                        <p>เริ่มสร้างคำถามใหม่เลย!</p>
                    </div>
                `;
            }
        } else {
            // แสดงคำถามที่กรองแล้ว
            filteredQuestions.forEach((question, index) => {
                questionsContainer.appendChild(createQuestionCard(question, index));
            });
        }
        
        // อัพเดตจำนวนคำถาม
        if (questionCount) {
            if (isReset) {
                questionCount.textContent = questions.length;
            } else if (filtered && filteredQuestions.length !== questions.length) {
                questionCount.textContent = `${filteredQuestions.length}/${questions.length}`;
            } else {
                questionCount.textContent = questions.length;
            }
        }
    }
}

// ฟังก์ชันสำหรับนับคำถามในแต่ละหมวดหมู่
function countQuestionsInCategory() {
    // สร้าง object สำหรับเก็บจำนวนคำถามในแต่ละหมวดหมู่
    const categoryCount = {};
    
    // วนลูปนับคำถามในแต่ละหมวดหมู่
    questions.forEach(question => {
        if (!question.category) return;
        
        const { main, sub1, sub2 } = question.category;
        
        // สร้าง key สำหรับแต่ละระดับหมวดหมู่
        const mainKey = main;
        const sub1Key = `${main}|${sub1}`;
        const sub2Key = `${main}|${sub1}|${sub2}`;
        
        // นับสำหรับหมวดหมู่หลัก
        if (!categoryCount[mainKey]) categoryCount[mainKey] = 0;
        categoryCount[mainKey]++;
        
        // นับสำหรับหมวดหมู่ย่อย 1
        if (!categoryCount[sub1Key]) categoryCount[sub1Key] = 0;
        categoryCount[sub1Key]++;
        
        // นับสำหรับหมวดหมู่ย่อย 2
        if (!categoryCount[sub2Key]) categoryCount[sub2Key] = 0;
        categoryCount[sub2Key]++;
    });
    
    return categoryCount;
}

// ฟังก์ชันแสดงหมวดหมู่แบบลำดับชั้น
function renderCategoryTree() {
    console.log("กำลังอัพเดตการแสดงผลต้นไม้หมวดหมู่...");
    
    // นับคำถามในแต่ละหมวดหมู่
    const categoryCount = countQuestionsInCategory();
    
    // เลือก container ที่จะแสดงผล
    const container = document.getElementById('category-tree-container');
    if (!container) {
        console.error("ไม่พบ element หมายเลข 'category-tree-container'");
        return;
    }
    
    // ล้างเนื้อหาเดิม
    container.innerHTML = '';
    
    // สร้าง HTML สำหรับหมวดหมู่หลัก
    for (const mainCategory in categories) {
        const mainCount = categoryCount[mainCategory] || 0;
        const mainCategoryDiv = document.createElement('div');
        mainCategoryDiv.className = 'category-item main-category';
        mainCategoryDiv.dataset.category = mainCategory;
        
        mainCategoryDiv.innerHTML = `
            <div class="category-header">
                <span class="toggle-icon">▶</span>
                <span class="category-name">${mainCategory}</span>
                <span class="question-count">(${mainCount})</span>
                <div class="category-actions">
                    <button class="edit-btn small-btn" data-action="edit" data-type="main" data-category="${mainCategory}">แก้ไข</button>
                    <button class="delete-btn small-btn" data-action="delete" data-type="main" data-category="${mainCategory}">ลบ</button>
                </div>
            </div>
            <div class="sub-categories" style="display: none;"></div>
        `;
        
        // เลือก elements ที่สร้างขึ้น
        const header = mainCategoryDiv.querySelector('.category-header');
        const subCategoriesDiv = mainCategoryDiv.querySelector('.sub-categories');
        const toggleIcon = mainCategoryDiv.querySelector('.toggle-icon');
        
        // เพิ่ม event listener สำหรับการคลิกเพื่อขยาย/หุบ
        header.addEventListener('click', function(e) {
            // ไม่ขยาย/หุบถ้าคลิกที่ปุ่มแก้ไขหรือลบ
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                return;
            }
            
            // สลับการแสดงผลของหมวดย่อย
            const isHidden = subCategoriesDiv.style.display === 'none';
            subCategoriesDiv.style.display = isHidden ? 'block' : 'none';
            toggleIcon.textContent = isHidden ? '▼' : '▶';
            
            // โหลดหมวดย่อย 1 ถ้ายังไม่ได้โหลด
            if (isHidden && subCategoriesDiv.children.length === 0) {
                renderSubCategories1(mainCategory, subCategoriesDiv, categoryCount);
            }
        });
        
        // เพิ่ม event listeners สำหรับปุ่มแก้ไขและลบ
        mainCategoryDiv.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', function(e) {
                e.stopPropagation(); // หยุดการกระจายของ event
                
                const action = this.dataset.action;
                const type = this.dataset.type;
                const category = this.dataset.category;
                
                if (action === 'edit') {
                    showEditCategoryForm(type, category);
                } else if (action === 'delete') {
                    confirmDeleteCategory(type, category);
                }
            });
        });
        
        // เพิ่มหมวดหมู่หลักเข้าไปใน container
        container.appendChild(mainCategoryDiv);
    }
    
    // เพิ่มปุ่มสำหรับเพิ่มหมวดหมู่หลักใหม่
    const addCategoryButton = document.createElement('div');
    addCategoryButton.className = 'add-category-btn';
    addCategoryButton.innerHTML = '<button class="add-btn">+ เพิ่มหมวดหมู่หลัก</button>';
    
    // เพิ่ม event listener สำหรับปุ่มเพิ่มหมวดหมู่
    addCategoryButton.querySelector('button').addEventListener('click', function() {
        showAddCategoryForm('main');
    });
    
    container.appendChild(addCategoryButton);
    
    console.log("อัพเดตการแสดงผลต้นไม้หมวดหมู่เรียบร้อยแล้ว");
}

// ฟังก์ชันแสดงหมวดหมู่ย่อย 1
function renderSubCategories1(mainCategory, container, categoryCount) {
    console.log("กำลังแสดงหมวดหมู่ย่อย 1 ของ", mainCategory);
    
    if (!categories[mainCategory]) {
        console.error("ไม่พบหมวดหมู่หลัก:", mainCategory);
        return;
    }
    
    // ล้างเนื้อหาเดิม
    container.innerHTML = '';
    
    // สร้าง HTML สำหรับแต่ละหมวดหมู่ย่อย 1
    for (const subCategory1 in categories[mainCategory]) {
        const sub1Key = `${mainCategory}|${subCategory1}`;
        const sub1Count = categoryCount[sub1Key] || 0;
        
        const subCategory1Div = document.createElement('div');
        subCategory1Div.className = 'category-item sub-category-1';
        subCategory1Div.dataset.category = subCategory1;
        subCategory1Div.dataset.parent = mainCategory;
        
        subCategory1Div.innerHTML = `
            <div class="category-header">
                <span class="toggle-icon">▶</span>
                <span class="category-name">${subCategory1}</span>
                <span class="question-count">(${sub1Count})</span>
                <div class="category-actions">
                    <button class="edit-btn small-btn" data-action="edit" data-type="sub1" data-category="${subCategory1}" data-parent="${mainCategory}">แก้ไข</button>
                    <button class="delete-btn small-btn" data-action="delete" data-type="sub1" data-category="${subCategory1}" data-parent="${mainCategory}">ลบ</button>
                </div>
            </div>
            <div class="sub-categories sub-categories-2" style="display: none;"></div>
        `;
        
        // เลือก elements ที่สร้างขึ้น
        const header = subCategory1Div.querySelector('.category-header');
        const subCategoriesDiv = subCategory1Div.querySelector('.sub-categories-2');
        const toggleIcon = subCategory1Div.querySelector('.toggle-icon');
        
        // เพิ่ม event listener สำหรับการคลิกเพื่อขยาย/หุบ
        header.addEventListener('click', function(e) {
            // ไม่ขยาย/หุบถ้าคลิกที่ปุ่มแก้ไขหรือลบ
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                return;
            }
            
            // สลับการแสดงผลของหมวดย่อย 2
            const isHidden = subCategoriesDiv.style.display === 'none';
            subCategoriesDiv.style.display = isHidden ? 'block' : 'none';
            toggleIcon.textContent = isHidden ? '▼' : '▶';
            
            // โหลดหมวดย่อย 2 ถ้ายังไม่ได้โหลด
            if (isHidden && subCategoriesDiv.children.length === 0) {
                renderSubCategories2(mainCategory, subCategory1, subCategoriesDiv, categoryCount);
            }
        });
        
        // เพิ่ม event listeners สำหรับปุ่มแก้ไขและลบ
        subCategory1Div.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', function(e) {
                e.stopPropagation(); // หยุดการกระจายของ event
                
                const action = this.dataset.action;
                const type = this.dataset.type;
                const category = this.dataset.category;
                const parent = this.dataset.parent;
                
                if (action === 'edit') {
                    showEditCategoryForm(type, category, parent);
                } else if (action === 'delete') {
                    confirmDeleteCategory(type, category, parent);
                }
            });
        });
        
        // เพิ่มหมวดหมู่ย่อย 1 เข้าไปใน container
        container.appendChild(subCategory1Div);
    }
    
    // เพิ่มปุ่มสำหรับเพิ่มหมวดหมู่ย่อย 1 ใหม่
    const addCategoryButton = document.createElement('div');
    addCategoryButton.className = 'add-category-btn';
    addCategoryButton.innerHTML = `<button class="add-btn">+ เพิ่มหมวดหมู่ย่อย 1</button>`;
    
    // เพิ่ม event listener สำหรับปุ่มเพิ่มหมวดหมู่
    addCategoryButton.querySelector('button').addEventListener('click', function() {
        showAddCategoryForm('sub1', mainCategory);
    });
    
    container.appendChild(addCategoryButton);
}
// ฟังก์ชันแสดงหมวดหมู่ย่อย 2
function renderSubCategories2(mainCategory, subCategory1, container, categoryCount) {
    console.log("กำลังแสดงหมวดหมู่ย่อย 2 ของ", mainCategory, ">", subCategory1);
    
    if (!categories[mainCategory] || !categories[mainCategory][subCategory1]) {
        console.error("ไม่พบหมวดหมู่ที่ระบุ:", mainCategory, ">", subCategory1);
        return;
    }
    
    // ล้างเนื้อหาเดิม
    container.innerHTML = '';
    
    // สร้าง HTML สำหรับแต่ละหมวดหมู่ย่อย 2 (ตอนนี้เป็น object แล้ว)
    for (const subCategory2Item of categories[mainCategory][subCategory1]) {
        // subCategory2Item ตอนนี้เป็น {name: "ชื่อ", is_locked: true/false}
        const subCategory2Name = subCategory2Item.name;
        const isLocked = subCategory2Item.is_locked || false;
        
        const sub2Key = `${mainCategory}|${subCategory1}|${subCategory2Name}`;
        const sub2Count = categoryCount[sub2Key] || 0;
        
        const subCategory2Div = document.createElement('div');
        subCategory2Div.className = 'category-item sub-category-2';
        subCategory2Div.dataset.category = subCategory2Name;
        subCategory2Div.dataset.parent = subCategory1;
        subCategory2Div.dataset.grandparent = mainCategory;
        
        // แสดงไอคอนล็อกถ้าถูกล็อก
        const lockIcon = isLocked ? ' 🔒' : ' 🔓';
        
        subCategory2Div.innerHTML = `
            <div class="category-header">
                <span class="category-name">${subCategory2Name}${lockIcon}</span>
                <span class="question-count">(${sub2Count})</span>
                <div class="category-actions">
                    <button class="edit-btn small-btn" data-action="edit" data-type="sub2" data-category="${subCategory2Name}" data-parent="${subCategory1}" data-grandparent="${mainCategory}">แก้ไข</button>
                    <button class="delete-btn small-btn" data-action="delete" data-type="sub2" data-category="${subCategory2Name}" data-parent="${subCategory1}" data-grandparent="${mainCategory}">ลบ</button>
                    <button class="lock-btn small-btn ${isLocked ? 'locked' : 'unlocked'}" data-action="toggle-lock" data-type="sub2" data-category="${subCategory2Name}" data-parent="${subCategory1}" data-grandparent="${mainCategory}" data-locked="${isLocked}">
                        ${isLocked ? 'ปลดล็อก' : 'ล็อก'}
                    </button>
                </div>
            </div>
        `;
        
        // เพิ่ม event listeners สำหรับปุ่มแก้ไข, ลบ และล็อก
        subCategory2Div.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', function(e) {
                e.stopPropagation(); // หยุดการกระจายของ event
                
                const action = this.dataset.action;
                const type = this.dataset.type;
                const category = this.dataset.category;
                const parent = this.dataset.parent;
                const grandparent = this.dataset.grandparent;
                
                if (action === 'edit') {
                    showEditCategoryForm(type, category, grandparent, parent);
                } else if (action === 'delete') {
                    confirmDeleteCategory(type, category, grandparent, parent);
                } else if (action === 'toggle-lock') {
                    const isCurrentlyLocked = this.dataset.locked === 'true';
                    toggleCategoryLock(grandparent, parent, category, !isCurrentlyLocked);
                }
            });
        });
        
        // เพิ่มหมวดหมู่ย่อย 2 เข้าไปใน container
        container.appendChild(subCategory2Div);
    }
    
    // เพิ่มปุ่มสำหรับเพิ่มหมวดหมู่ย่อย 2 ใหม่
    const addCategoryButton = document.createElement('div');
    addCategoryButton.className = 'add-category-btn';
    addCategoryButton.innerHTML = `<button class="add-btn">+ เพิ่มหมวดหมู่ย่อย 2</button>`;
    
    // เพิ่ม event listener สำหรับปุ่มเพิ่มหมวดหมู่
    addCategoryButton.querySelector('button').addEventListener('click', function() {
        showAddCategoryForm('sub2', mainCategory, subCategory1);
    });
    
    container.appendChild(addCategoryButton);
}

// เพิ่มฟังก์ชันสำหรับการเปิด/ปิดล็อกหมวดหมู่
async function toggleCategoryLock(mainCategory, subCategory1, subCategory2, shouldLock) {
    try {
        console.log(`${shouldLock ? 'ล็อก' : 'ปลดล็อก'}หมวดหมู่:`, mainCategory, '>', subCategory1, '>', subCategory2);
        
        // อัพเดตใน Database
        const { error } = await supabaseClient
            .from('categories')
            .update({ is_locked: shouldLock })
            .eq('name', subCategory2)
            .eq('level', 3)
            .eq('parent_name', `${mainCategory} > ${subCategory1}`);
        
        if (error) {
            throw new Error('เกิดข้อผิดพลาด: ' + error.message);
        }
        
        // โหลดข้อมูลใหม่
        await loadCategories();
        
        // อัพเดตการแสดงผล
        renderCategoryTree();
        updateCategoryUI();
        
        console.log(`${shouldLock ? 'ล็อก' : 'ปลดล็อก'}หมวดหมู่เรียบร้อยแล้ว`);
        
    } catch (error) {
        console.error("เกิดข้อผิดพลาดในการเปลี่ยนสถานะล็อก:", error);
        alert("เกิดข้อผิดพลาด: " + error.message);
    }
}

// ฟังก์ชัน showAddCategoryForm ที่ปรับปรุงใหม่
function showAddCategoryForm(type, parent = null, grandparent = null) {
    // หยุดการกระจายของ event
    if (window.event) {
        window.event.stopPropagation();
    }
    
    console.log("เปิดฟอร์มเพิ่มหมวดหมู่:", type, parent, grandparent);
    
    // สร้างฟอร์มสำหรับเพิ่มหมวดหมู่
    const formContainer = document.getElementById('category-form-container');
    if (!formContainer) {
        console.error("ไม่พบ element หมายเลข 'category-form-container'");
        return;
    }
    
    let inputLabel = '';
    let titleText = '';
    
    switch (type) {
        case 'main':
            inputLabel = 'ชื่อหมวดหมู่หลัก';
            titleText = 'เพิ่มหมวดหมู่หลัก';
            break;
        case 'sub1':
            inputLabel = 'ชื่อหมวดหมู่ย่อย 1';
            titleText = `เพิ่มหมวดหมู่ย่อย 1 (ภายใต้ ${parent})`;
            break;
        case 'sub2':
            inputLabel = 'ชื่อหมวดหมู่ย่อย 2';
            titleText = `เพิ่มหมวดหมู่ย่อย 2 (ภายใต้ ${parent} > ${grandparent})`;
            break;
    }
    
    // ล้างเนื้อหาเดิมของ formContainer
    formContainer.innerHTML = '';
    
    // สร้าง elements แบบปลอดภัยกว่า
    const formBody = document.createElement('div');
    formBody.className = 'form-body';
    
    formBody.innerHTML = `
        <div class="form-header">
            <h3>${titleText}</h3>
            <button type="button" class="close-btn" id="close-category-form">×</button>
        </div>
        <div class="form-group">
            <label for="category-name">${inputLabel}:</label>
            <input type="text" id="category-name" class="form-input" placeholder="กรุณากรอกชื่อหมวดหมู่">
        </div>
        <div class="form-actions">
            <button type="button" class="save-btn" id="save-category-btn">บันทึก</button>
            <button type="button" class="cancel-btn" id="cancel-category-btn">ยกเลิก</button>
        </div>
    `;
    
    formContainer.appendChild(formBody);
    
    // แสดงฟอร์ม
    formContainer.style.display = 'flex';
    
    // เพิ่ม event listeners หลังจากที่ elements ถูกเพิ่มเข้าไปใน DOM
    document.getElementById('close-category-form').onclick = function() {
        closeAddCategoryForm();
    };
    
    document.getElementById('cancel-category-btn').onclick = function() {
        closeAddCategoryForm();
    };
    
    // บันทึกข้อมูลเมื่อคลิกปุ่มบันทึก
    document.getElementById('save-category-btn').onclick = function() {
        addCategory(type, parent, grandparent);
    };
    
    // รองรับการกด Enter ในช่อง input
    document.getElementById('category-name').addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            addCategory(type, parent, grandparent);
        }
    });
    
    // โฟกัสที่ input
    setTimeout(() => {
        const input = document.getElementById('category-name');
        if (input) input.focus();
    }, 100);
}

// เพิ่มฟังก์ชันนี้ต่อจากฟังก์ชัน showAddCategoryForm หรือก่อนฟังก์ชัน updateCategory

function showEditCategoryForm(type, category, parent = null, grandparent = null) {
    // หยุดการกระจายของ event
    if (window.event) {
        window.event.stopPropagation();
    }
    
    console.log("เปิดฟอร์มแก้ไขหมวดหมู่:", type, category, parent, grandparent);
    
    // สร้างฟอร์มสำหรับแก้ไขหมวดหมู่
    const formContainer = document.getElementById('category-form-container');
    if (!formContainer) {
        console.error("ไม่พบ element หมายเลข 'category-form-container'");
        return;
    }
    
    let inputLabel = '';
    let titleText = '';
    
    switch (type) {
        case 'main':
            inputLabel = 'ชื่อหมวดหมู่หลัก';
            titleText = `แก้ไขหมวดหมู่หลัก "${category}"`;
            break;
        case 'sub1':
            inputLabel = 'ชื่อหมวดหมู่ย่อย 1';
            titleText = `แก้ไขหมวดหมู่ย่อย 1 "${category}" (ภายใต้ ${parent})`;
            break;
        case 'sub2':
            inputLabel = 'ชื่อหมวดหมู่ย่อย 2';
            titleText = `แก้ไขหมวดหมู่ย่อย 2 "${category}" (ภายใต้ ${parent} > ${grandparent})`;
            break;
    }
    
    // ล้างเนื้อหาเดิมของ formContainer
    formContainer.innerHTML = '';
    
    // สร้าง elements แบบปลอดภัยกว่า
    const formBody = document.createElement('div');
    formBody.className = 'form-body';
    
    formBody.innerHTML = `
        <div class="form-header">
            <h3>${titleText}</h3>
            <button type="button" class="close-btn" id="close-category-form">×</button>
        </div>
        <div class="form-group">
            <label for="category-name">${inputLabel}:</label>
            <input type="text" id="category-name" class="form-input" value="${category}" placeholder="กรุณากรอกชื่อหมวดหมู่">
        </div>
        <div class="form-actions">
            <button type="button" class="save-btn" id="save-category-btn">บันทึก</button>
            <button type="button" class="cancel-btn" id="cancel-category-btn">ยกเลิก</button>
        </div>
    `;
    
    formContainer.appendChild(formBody);
    
    // แสดงฟอร์ม
    formContainer.style.display = 'flex';
    
    // เพิ่ม event listeners หลังจากที่ elements ถูกเพิ่มเข้าไปใน DOM
    document.getElementById('close-category-form').onclick = function() {
        closeAddCategoryForm();
    };
    
    document.getElementById('cancel-category-btn').onclick = function() {
        closeAddCategoryForm();
    };
    
    // บันทึกข้อมูลเมื่อคลิกปุ่มบันทึก
    document.getElementById('save-category-btn').onclick = function() {
        updateCategory(type, category, parent, grandparent);
    };
    
    // รองรับการกด Enter ในช่อง input
    document.getElementById('category-name').addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            updateCategory(type, category, parent, grandparent);
        }
    });
    
    // โฟกัสที่ input
    setTimeout(() => {
        const input = document.getElementById('category-name');
        if (input) input.focus();
    }, 100);
}

function closeAddCategoryForm() {
    const formContainer = document.getElementById('category-form-container');
    if (formContainer) {
        formContainer.innerHTML = '';
        formContainer.style.display = 'none';
    }
}
async function updateCategory(type, oldName, mainCategory = null, subCategory1 = null) {
    const newName = document.getElementById('category-name').value.trim();
    
    if (!newName) {
        alert('กรุณากรอกชื่อหมวดหมู่');
        return;
    }
    
    if (oldName === newName) {
        closeAddCategoryForm();
        return;
    }
    
    try {
        switch (type) {
            case 'main':
                // ตรวจสอบว่ามีหมวดหมู่หลักใหม่นี้อยู่แล้วหรือไม่
                const { data: existingMain } = await supabaseClient
                    .from('categories')
                    .select('id')
                    .eq('name', newName)
                    .eq('level', 1);
                
                if (existingMain && existingMain.length > 0) {
                    alert('มีหมวดหมู่หลักนี้อยู่แล้ว');
                    return;
                }
                
                // อัพเดตหมวดหมู่หลัก
                await supabaseClient
                    .from('categories')
                    .update({ name: newName })
                    .eq('name', oldName)
                    .eq('level', 1);
                
                // อัพเดต parent_name ของหมวดหมู่ย่อย 1
                await supabaseClient
                    .from('categories')
                    .update({ parent_name: newName })
                    .eq('parent_name', oldName)
                    .eq('level', 2);
                
                // อัพเดต parent_name ของหมวดหมู่ย่อย 2
                const { data: sub2Categories } = await supabaseClient
                    .from('categories')
                    .select('*')
                    .like('parent_name', `${oldName} > %`)
                    .eq('level', 3);
                
                if (sub2Categories) {
                    for (const sub2 of sub2Categories) {
                        const newParentName = sub2.parent_name.replace(oldName, newName);
                        await supabaseClient
                            .from('categories')
                            .update({ parent_name: newParentName })
                            .eq('id', sub2.id);
                    }
                }
                
                // อัพเดตคำถาม
                await supabaseClient
                    .from('questions')
                    .update({ category_main: newName })
                    .eq('category_main', oldName);
                break;
                
            case 'sub1':
                // ตรวจสอบว่ามีหมวดหมู่ย่อย 1 ใหม่นี้อยู่แล้วหรือไม่
                const { data: existingSub1 } = await supabaseClient
                    .from('categories')
                    .select('id')
                    .eq('name', newName)
                    .eq('level', 2)
                    .eq('parent_name', mainCategory);
                
                if (existingSub1 && existingSub1.length > 0) {
                    alert('มีหมวดหมู่ย่อย 1 นี้อยู่แล้ว');
                    return;
                }
                
                // อัพเดตหมวดหมู่ย่อย 1
                await supabaseClient
                    .from('categories')
                    .update({ name: newName })
                    .eq('name', oldName)
                    .eq('level', 2)
                    .eq('parent_name', mainCategory);
                
                // อัพเดต parent_name ของหมวดหมู่ย่อย 2
                const oldParentPath = `${mainCategory} > ${oldName}`;
                const newParentPath = `${mainCategory} > ${newName}`;
                
                await supabaseClient
                    .from('categories')
                    .update({ parent_name: newParentPath })
                    .eq('parent_name', oldParentPath)
                    .eq('level', 3);
                
                // อัพเดตคำถาม
                await supabaseClient
                    .from('questions')
                    .update({ category_sub1: newName })
                    .eq('category_main', mainCategory)
                    .eq('category_sub1', oldName);
                break;
                
            case 'sub2':
                // ตรวจสอบว่ามีหมวดหมู่ย่อย 2 ใหม่นี้อยู่แล้วหรือไม่
                const { data: existingSub2 } = await supabaseClient
                    .from('categories')
                    .select('id')
                    .eq('name', newName)
                    .eq('level', 3)
                    .eq('parent_name', `${mainCategory} > ${subCategory1}`);
                
                if (existingSub2 && existingSub2.length > 0) {
                    alert('มีหมวดหมู่ย่อย 2 นี้อยู่แล้ว');
                    return;
                }
                
                // อัพเดตหมวดหมู่ย่อย 2
                await supabaseClient
                    .from('categories')
                    .update({ name: newName })
                    .eq('name', oldName)
                    .eq('level', 3)
                    .eq('parent_name', `${mainCategory} > ${subCategory1}`);
                
                // อัพเดตคำถาม
                await supabaseClient
                    .from('questions')
                    .update({ category_sub2: newName })
                    .eq('category_main', mainCategory)
                    .eq('category_sub1', subCategory1)
                    .eq('category_sub2', oldName);
                break;
        }
        
        // โหลดข้อมูลใหม่
        await loadCategories();
        await loadQuestions();
        
        // ปิดฟอร์ม
        closeAddCategoryForm();
        
        // อัพเดตการแสดงผล
        renderCategoryTree();
        updateCategoryUI();
        displayQuestions();
        
        alert('แก้ไขหมวดหมู่เรียบร้อยแล้ว');
        
    } catch (error) {
        console.error("เกิดข้อผิดพลาดในการแก้ไขหมวดหมู่:", error);
        alert("เกิดข้อผิดพลาด: " + error.message);
    }
}

// นำฟังก์ชันนี้ไปแทนที่ฟังก์ชัน confirmDeleteCategory() เดิมทั้งหมด
function confirmDeleteCategory(type, categoryName, mainCategory = null, subCategory1 = null) {
    // หยุดการ propagation ของ event click เพื่อไม่ให้ไปเรียก toggle
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    // นับจำนวนคำถามที่จะได้รับผลกระทบ
    let affectedQuestions = 0;
    
    switch (type) {
        case 'main':
            // นับคำถามที่อยู่ในหมวดหมู่หลักนี้
            affectedQuestions = questions.filter(q => 
                q.category && q.category.main === categoryName
            ).length;
            break;
            
        case 'sub1':
            // นับคำถามที่อยู่ในหมวดหมู่ย่อย 1 นี้
            affectedQuestions = questions.filter(q => 
                q.category && 
                q.category.main === mainCategory && 
                q.category.sub1 === categoryName
            ).length;
            break;
            
        case 'sub2':
            // นับคำถามที่อยู่ในหมวดหมู่ย่อย 2 นี้
            affectedQuestions = questions.filter(q => 
                q.category && 
                q.category.main === mainCategory && 
                q.category.sub1 === subCategory1 && 
                q.category.sub2 === categoryName
            ).length;
            break;
    }
    
    // สร้างหน้าต่างยืนยัน
    const confirmContainer = document.getElementById('category-confirm-container');
    if (!confirmContainer) return;
    
    let title = '';
    let message = '';
    
    switch (type) {
        case 'main':
            title = 'ลบหมวดหมู่หลัก';
            message = `คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่หลัก "${categoryName}"? การลบหมวดหมู่หลักจะลบหมวดหมู่ย่อยทั้งหมดที่อยู่ภายในด้วย`;
            break;
        case 'sub1':
            title = 'ลบหมวดหมู่ย่อย 1';
            message = `คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่ย่อย 1 "${categoryName}"? การลบหมวดหมู่ย่อย 1 จะลบหมวดหมู่ย่อย 2 ทั้งหมดที่อยู่ภายในด้วย`;
            break;
        case 'sub2':
            title = 'ลบหมวดหมู่ย่อย 2';
            message = `คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่ย่อย 2 "${categoryName}"?`;
            break;
    }
    
    // เพิ่มข้อความเกี่ยวกับคำถามที่จะได้รับผลกระทบ
    if (affectedQuestions > 0) {
        message += `<br><br><strong class="warning-text">คำเตือน:</strong> การลบหมวดหมู่นี้จะส่งผลกระทบต่อคำถามจำนวน ${affectedQuestions} ข้อ ซึ่งคำถามเหล่านี้จะถูกลบไปด้วย`;
    }
    
    confirmContainer.innerHTML = `
    <div class="confirm-dialog">
        <div class="confirm-header">
            <h3>${title}</h3>
            <button class="close-btn" onclick="closeConfirmDeleteDialog()">×</button>
        </div>
        <div class="confirm-body">
            <p>${message}</p>
        </div>
        <div class="confirm-actions">
            <button class="delete-btn" onclick="deleteCategory('${type}', '${categoryName}', '${mainCategory || ''}', '${subCategory1 || ''}')">ยืนยันการลบ</button>
            <button class="cancel-btn" onclick="closeConfirmDeleteDialog()">ยกเลิก</button>
        </div>
    </div>
`;
    
    // แสดงหน้าต่างยืนยัน
    confirmContainer.style.display = 'flex';
}

// เพิ่มฟังก์ชันนี้ต่อท้ายฟังก์ชัน confirmDeleteCategory()
function closeConfirmDeleteDialog() {
    const confirmContainer = document.getElementById('category-confirm-container');
    if (confirmContainer) {
        confirmContainer.innerHTML = '';
        confirmContainer.style.display = 'none';
    }
}

async function deleteCategory(type, categoryName, mainCategory = null, subCategory1 = null) {
    try {
        switch (type) {
            case 'main':
                // ลบหมวดหมู่ย่อยทั้งหมดที่เกี่ยวข้อง
                await supabaseClient
                    .from('categories')
                    .delete()
                    .or(`parent_name.eq.${categoryName},parent_name.like.${categoryName} > %`);
                
                // ลบหมวดหมู่หลัก
                await supabaseClient
                    .from('categories')
                    .delete()
                    .eq('name', categoryName)
                    .eq('level', 1);
                
                // ลบคำถามที่เกี่ยวข้อง
                await supabaseClient
                    .from('questions')
                    .delete()
                    .eq('category_main', categoryName);
                break;
                
            case 'sub1':
                // ลบหมวดหมู่ย่อย 2 ที่เกี่ยวข้อง
                const parentPath = `${mainCategory} > ${categoryName}`;
                await supabaseClient
                    .from('categories')
                    .delete()
                    .eq('level', 3)
                    .eq('parent_name', parentPath);
                
                // ลบหมวดหมู่ย่อย 1
                await supabaseClient
                    .from('categories')
                    .delete()
                    .eq('name', categoryName)
                    .eq('level', 2)
                    .eq('parent_name', mainCategory);
                
                // ลบคำถามที่เกี่ยวข้อง
                await supabaseClient
                    .from('questions')
                    .delete()
                    .eq('category_main', mainCategory)
                    .eq('category_sub1', categoryName);
                break;
                
            case 'sub2':
                // ลบหมวดหมู่ย่อย 2
                await supabaseClient
                    .from('categories')
                    .delete()
                    .eq('name', categoryName)
                    .eq('level', 3)
                    .eq('parent_name', `${mainCategory} > ${subCategory1}`);
                
                // ลบคำถามที่เกี่ยวข้อง
                await supabaseClient
                    .from('questions')
                    .delete()
                    .eq('category_main', mainCategory)
                    .eq('category_sub1', subCategory1)
                    .eq('category_sub2', categoryName);
                break;
        }
        
        // โหลดข้อมูลใหม่
        await loadCategories();
        await loadQuestions();
        
        // ปิดหน้าต่างยืนยัน
        closeConfirmDeleteDialog();
        
        // อัพเดตการแสดงผล
        renderCategoryTree();
        updateCategoryUI();
        displayQuestions();
        
        alert('ลบหมวดหมู่เรียบร้อยแล้ว');
        
        return true;
    } catch (error) {
        console.error("เกิดข้อผิดพลาดในการลบหมวดหมู่:", error);
        alert("เกิดข้อผิดพลาด: " + error.message);
        return false;
    }
}

// ฟังก์ชันเริ่มต้นระบบหมวดหมู่แบบใหม่
async function initCategorySystemNew() {
    console.log("กำลังเริ่มต้นระบบหมวดหมู่...");
    
    try {
        // โหลดหมวดหมู่จาก Database
        await loadCategories();
        
        // ถ้าไม่มีหมวดหมู่ ให้สร้างตัวอย่าง
        if (Object.keys(categories).length === 0) {
            console.log("ไม่มีหมวดหมู่ กำลังสร้างตัวอย่าง...");
            await createSampleCategories();
            await loadCategories();
        }
        
        // สร้างโครงสร้าง UI
        renderCategoryTree();
        updateCategorySelects();
        
        console.log("ระบบหมวดหมู่พร้อมใช้งานแล้ว");
        
    } catch (error) {
        console.error("เกิดข้อผิดพลาด:", error);
        // ใช้หมวดหมู่เริ่มต้น
        categories = {
            "ความรู้ทั่วไป": {
                "วิทยาศาสตร์": ["ฟิสิกส์"],
                "คณิตศาสตร์": ["พีชคณิต"]
            }
        };
        renderCategoryTree();
        updateCategorySelects();
    }
}

async function createSampleCategories() {
    try {
        const sampleCategories = [
            // หมวดหมู่หลัก
            { name: "ความรู้ทั่วไป", level: 1, parent_name: null },
            { name: "ภาษา", level: 1, parent_name: null },
            
            // หมวดหมู่ย่อย 1
            { name: "วิทยาศาสตร์", level: 2, parent_name: "ความรู้ทั่วไป" },
            { name: "คณิตศาสตร์", level: 2, parent_name: "ความรู้ทั่วไป" },
            { name: "ภาษาอังกฤษ", level: 2, parent_name: "ภาษา" },
            
            // หมวดหมู่ย่อย 2
            { name: "ฟิสิกส์", level: 3, parent_name: "ความรู้ทั่วไป > วิทยาศาสตร์" },
            { name: "เคมี", level: 3, parent_name: "ความรู้ทั่วไป > วิทยาศาสตร์" },
            { name: "พีชคณิต", level: 3, parent_name: "ความรู้ทั่วไป > คณิตศาสตร์" },
            { name: "ไวยากรณ์", level: 3, parent_name: "ภาษา > ภาษาอังกฤษ" }
        ];
        
        const { error } = await supabaseClient
            .from('categories')
            .insert(sampleCategories);
        
        if (error) {
            throw new Error('เกิดข้อผิดพลาด: ' + error.message);
        }
        
        console.log("สร้างหมวดหมู่ตัวอย่างเรียบร้อยแล้ว");
        return true;
        
    } catch (error) {
        console.error("เกิดข้อผิดพลาดในการสร้างหมวดหมู่ตัวอย่าง:", error);
        return false;
    }
}

async function migrateCategoriesFromLocalStorage() {
    try {
        const savedCategories = localStorage.getItem('quiz-categories');
        if (!savedCategories) {
            return false;
        }
        
        const oldCategories = JSON.parse(savedCategories);
        if (Object.keys(oldCategories).length === 0) {
            return false;
        }
        
        console.log('กำลัง migrate ข้อมูลหมวดหมู่...');
        
        const categoriesToInsert = [];
        
        for (const mainCategory in oldCategories) {
            // เพิ่มหมวดหมู่หลัก
            categoriesToInsert.push({
                name: mainCategory,
                level: 1,
                parent_name: null
            });
            
            for (const subCategory1 in oldCategories[mainCategory]) {
                // เพิ่มหมวดหมู่ย่อย 1
                categoriesToInsert.push({
                    name: subCategory1,
                    level: 2,
                    parent_name: mainCategory
                });
                
                for (const subCategory2 of oldCategories[mainCategory][subCategory1]) {
                    // เพิ่มหมวดหมู่ย่อย 2
                    categoriesToInsert.push({
                        name: subCategory2,
                        level: 3,
                        parent_name: `${mainCategory} > ${subCategory1}`
                    });
                }
            }
        }
        
        const { error } = await supabaseClient
            .from('categories')
            .insert(categoriesToInsert);
        
        if (error) {
            throw new Error('เกิดข้อผิดพลาด: ' + error.message);
        }
        
        console.log('Migrate สำเร็จ');
        localStorage.removeItem('quiz-categories');
        
        return true;
        
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการ migrate:', error);
        return false;
    }
}

// ฟังก์ชันแสดงรายละเอียดการเล่นเกม
function showGameDetails(historyId) {
    console.log("แสดงรายละเอียดการเล่น ID:", historyId);
    
    // หาข้อมูลประวัติ
    const historyEntry = gameHistory.find(entry => entry.id === historyId);
    if (!historyEntry) {
        alert('ไม่พบข้อมูลประวัติการเล่น');
        return;
    }
    
    // ตรวจสอบว่ามีข้อมูลเกมหรือไม่
    if (!historyEntry.gameData || !historyEntry.gameData.questions) {
        alert('ข้อมูลรายละเอียดการเล่นไม่สมบูรณ์ (ประวัติเก่าอาจไม่มีข้อมูลนี้)');
        return;
    }
    
    // สร้าง Modal
    createGameDetailsModal(historyEntry);
}

// ฟังก์ชันสร้าง Modal แสดงรายละเอียด
function createGameDetailsModal(historyEntry) {
    // ลบ Modal เดิม (ถ้ามี)
    const existingModal = document.getElementById('game-details-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // สร้าง Modal ใหม่
    const modal = document.createElement('div');
    modal.id = 'game-details-modal';
    modal.className = 'game-details-modal-overlay';
    
    // สร้างเนื้อหา Modal
    const modalContent = createModalContent(historyEntry);
    modal.appendChild(modalContent);
    
    // เพิ่มลงใน DOM
    document.body.appendChild(modal);
    
    // เพิ่ม event listener สำหรับปิด Modal
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeGameDetailsModal();
        }
    });
    
    // ป้องกัน scroll ของ body
    document.body.style.overflow = 'hidden';
}

// ฟังก์ชันสร้างเนื้อหา Modal
function createModalContent(historyEntry) {
    const { gameData, playerName, score, totalQuestions, percentage, category, playedAt } = historyEntry;
    const { questions, userAnswers, randomOrder } = gameData;
    
    // แปลงวันที่และเวลา (24 ชั่วโมง)
const dateTimeFormatted = formatDateTime24Hour(playedAt);
const formattedDate = dateTimeFormatted.date;
const formattedTime = dateTimeFormatted.time;
    
    // สร้าง container หลัก
    const container = document.createElement('div');
    container.className = 'game-details-modal';
    
    // สร้าง header
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `
        <div class="modal-title">
            <h2>รายละเอียดการเล่นเกม</h2>
            <button class="modal-close-btn" onclick="closeGameDetailsModal()">×</button>
        </div>
        <div class="player-result-header">
            <div class="player-result-avatar">${getPlayerInitials(playerName)}</div>
            <div class="player-result-info">
                <div class="player-result-name">${playerName}</div>
                <div class="play-datetime">${formattedDate} ${formattedTime}</div>
            </div>
        </div>
    `;
    
    // สร้างส่วนแสดงคะแนน
    const scoreSection = document.createElement('div');
    scoreSection.className = 'modal-score-section';
    scoreSection.innerHTML = `
        <div class="result-score-container">
            <div class="result-score">
                <div class="score-display">
                    <div class="score-value">${score}</div>
                    <div class="score-separator">/</div>
                    <div class="score-max">${totalQuestions}</div>
                </div>
                <div class="score-percent">${percentage}%</div>
            </div>
        </div>
        
        <div class="quiz-stats">
            <div class="stat-item">
                <div class="stat-value correct-value">${score}</div>
                <div class="stat-label">ตอบถูก</div>
            </div>
            <div class="stat-item">
                <div class="stat-value incorrect-value">${totalQuestions - score}</div>
                <div class="stat-label">ตอบผิด</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${totalQuestions}</div>
                <div class="stat-label">คำถามทั้งหมด</div>
            </div>
        </div>
    `;
    
    // สร้างส่วนแสดงหมวดหมู่
    const categorySection = document.createElement('div');
    if (category) {
        categorySection.className = 'category-summary';
        categorySection.innerHTML = `
            <div class="category-title">หมวดหมู่:</div>
            <div class="category-path">${category.main || 'ไม่ระบุ'} > ${category.sub1 || 'ไม่ระบุ'} > ${category.sub2 || 'ไม่ระบุ'}</div>
        `;
    }
    
    // สร้างส่วนทบทวนคำถาม
    const reviewSection = document.createElement('div');
    reviewSection.className = 'modal-review-section';
    reviewSection.innerHTML = '<h3>สรุปคำถามและคำตอบ</h3>';
    
    const questionsList = document.createElement('div');
    questionsList.className = 'question-review-list';
    
    // สร้างรายการคำถาม
    randomOrder.forEach((questionIndex, index) => {
        const question = questions[questionIndex];
        const userAnswer = userAnswers[questionIndex] || '';
        const isCorrect = userAnswer === question.correctAnswer;
        
        const reviewItem = document.createElement('div');
        reviewItem.className = `question-review-item ${isCorrect ? 'correct' : 'incorrect'}`;
        
        let choicesHTML = '';
        question.choices.forEach(choice => {
            const isUserSelected = choice.id === userAnswer;
            const isCorrectAnswer = choice.id === question.correctAnswer;
            
            let className = 'choice-item';
            if (isUserSelected) className += ' user-selected';
            if (isCorrectAnswer) className += ' correct-answer';
            
            let icon = '';
            if (isUserSelected && isCorrectAnswer) {
                icon = '<span class="choice-icon correct-icon">✓</span>';
            } else if (isUserSelected && !isCorrectAnswer) {
                icon = '<span class="choice-icon incorrect-icon">✗</span>';
            } else if (!isUserSelected && isCorrectAnswer) {
                icon = '<span class="choice-icon correct-icon">✓</span>';
            }
            
            choicesHTML += `
                <div class="${className}">
                    <span class="choice-marker">${choice.id}</span>
                    <span class="choice-text">${choice.text}</span>
                    ${icon}
                </div>
            `;
        });
        
        reviewItem.innerHTML = `
            <div class="question-number">
                <span>ข้อที่ ${index + 1}</span>
                <span class="question-status ${isCorrect ? 'status-correct' : 'status-incorrect'}">
                    ${isCorrect ? 'ตอบถูก' : 'ตอบผิด'}
                </span>
            </div>
            <div class="question-text">${question.text}</div>
            ${question.image ? `<img src="${question.image}" class="question-image">` : ''}
            <div class="choice-list">
                ${choicesHTML}
            </div>
        `;
        
        questionsList.appendChild(reviewItem);
    });
    
    reviewSection.appendChild(questionsList);
    
    // รวม elements ทั้งหมด
    container.appendChild(header);
    container.appendChild(scoreSection);
    if (category) container.appendChild(categorySection);
    container.appendChild(reviewSection);
    
    return container;
}

// ฟังก์ชันปิด Modal
function closeGameDetailsModal() {
    const modal = document.getElementById('game-details-modal');
    if (modal) {
        modal.remove();
    }
    
    // คืนค่า scroll ของ body
    document.body.style.overflow = '';
}

// ฟังก์ชันเริ่มต้นระบบแอดมิน - แก้ไขใหม่
function initAdminSystem() {
    console.log("กำลังเริ่มต้นระบบแอดมิน...");
    
    // *** แก้ไขสำคัญ: ไม่ตั้ง Auth State Listener ที่จะทำงานทันที ***
    // แทนที่จะเป็นการตรวจสอบอัตโนมัติ เปลี่ยนเป็นตรวจสอบเฉพาะเมื่อต้องการ
    
    // ซ่อนแท็บแอดมินเป็นค่าเริ่มต้น
    updateAdminTabs();
    
    console.log("ระบบแอดมินพร้อมใช้งานแล้ว");
}

// ฟังก์ชันตรวจสอบสิทธิ์การเข้าถึงหมวดหมู่
function canPlayerAccessCategory(mainCategory, subCategory1, subCategory2) {
    // Admin เข้าได้ทุกหมวดหมู่
    if (isAdminMode && adminProfile) {
        return true;
    }
    
    // ตรวจสอบว่าหมวดหมู่ย่อย 2 ถูกล็อกหรือไม่
    return !isCategoryLocked(mainCategory, subCategory1, subCategory2);
}

// ฟังก์ชันจัดการการกดปุ่มคีย์บอร์ด (ไม่ใช้แล้ว แต่เก็บไว้เผื่ออนาคต)
function handleAdminKeyInput(event) {
    // ไม่ใช้ F10 แล้ว เปลี่ยนเป็นใช้การกรอกชื่อผู้เล่น
}

// ฟังก์ชันเปิดโหมดแอดมิน - แก้ไขใหม่
function activateAdminMode() {
    console.log("กำลังเปิดโหมดแอดมิน...");
    
    // แสดงแท็บแอดมิน
    updateAdminTabs();
    
    // เพิ่ม Admin UI
    addAdminUI();
        
    console.log("เปิดโหมดแอดมินเรียบร้อยแล้ว");
}

// ฟังก์ชันปิดโหมดแอดมิน - แก้ไขใหม่
function deactivateAdminMode() {
    console.log("กำลังปิดโหมดแอดมิน...");
    
    // ซ่อนแท็บแอดมิน
    updateAdminTabs();
    
    // ลบ Admin UI
    removeAdminUI();
    
    // รีเซ็ตผู้เล่นปัจจุบัน
    currentPlayer = null;
    
    // กลับไปแท็บเล่นเกมและแสดงหน้าล็อกอิน
    const playTab = document.getElementById('play-tab');
    if (playTab && !playTab.classList.contains('active')) {
        playTab.click();
    }
    
    // แสดงหน้าล็อกอินใหม่
    setTimeout(() => {
        updateLoginDisplay();
    }, 100);
    
    console.log("ปิดโหมดแอดมินเรียบร้อยแล้ว");
}

// ฟังก์ชันเพิ่ม Admin UI - ตรวจสอบให้แน่ใจว่ามีฟังก์ชัน
function addAdminUI() {
    // ตรวจสอบว่ามี UI อยู่แล้วหรือไม่
    if (document.getElementById('admin-ui-container')) {
        console.log("Admin UI มีอยู่แล้ว");
        return;
    }
    
    // สร้าง container สำหรับ Admin UI
    const adminContainer = document.createElement('div');
    adminContainer.id = 'admin-ui-container';
    adminContainer.className = 'admin-ui-container';
    
    // สร้าง Admin Mode Badge (แสดงอย่างเดียว)
    const adminBadge = document.createElement('div');
    adminBadge.className = 'admin-mode-indicator';
    adminBadge.innerHTML = '👑 Admin Mode';
    
    // สร้างปุ่มออกจากระบบ (กดได้)
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'admin-logout-btn';
    logoutBtn.innerHTML = '🚪 ออกจากระบบ';
    logoutBtn.onclick = function() {
        if (confirm('คุณต้องการออกจากระบบแอดมินใช่หรือไม่?')) {
            logoutAdmin();
        }
    };
    
    // รวม elements
    adminContainer.appendChild(adminBadge);
    adminContainer.appendChild(logoutBtn);
    
    // เพิ่มเข้าไปในหน้าเว็บ
    document.body.appendChild(adminContainer);
    
    console.log("เพิ่ม Admin UI เรียบร้อยแล้ว");
}

// ฟังก์ชันลบ Admin UI - ตรวจสอบให้แน่ใจว่ามีฟังก์ชัน
function removeAdminUI() {
    const adminContainer = document.getElementById('admin-ui-container');
    if (adminContainer) {
        adminContainer.remove();
        console.log("ลบ Admin UI เรียบร้อยแล้ว");
    }
}

// วางแทนฟังก์ชัน updateAdminTabs() เดิม
function updateAdminTabs() {
    const historyTab = document.getElementById('history-tab');
    const createTab = document.getElementById('create-tab');
    
    if (userMode === 'admin' || isAdminMode) {
        // โหมดแอดมิน: แสดงทุกแท็บ
        if (historyTab) {
            historyTab.style.display = 'block';
            historyTab.textContent = 'ประวัติการเล่น (Admin)';
        }
        if (createTab) {
            createTab.style.display = 'block';
        }
    } else {
        // โหมดผู้เล่นทั่วไป: ซ่อนแท็บตั้งค่า
        if (historyTab) {
            historyTab.style.display = 'block';
            historyTab.textContent = 'ประวัติการเล่น';
        }
        if (createTab) {
            createTab.style.display = 'none';
        }
    }
}

// ฟังก์ชันกรองประวัติตามผู้เล่น
function getPlayerHistory() {
    if (!currentPlayer) {
        return [];
    }
    
    if (isAdminMode) {
        // แอดมินเห็นประวัติทั้งหมด
        return gameHistory;
    } else {
        // ผู้เล่นธรรมดาเห็นเฉพาะของตัวเอง
        return gameHistory.filter(entry => 
            entry.playerName === currentPlayer.name
        );
    }
}

// ฟังก์ชันแสดงประวัติสำหรับผู้เล่น (แยกจาก Admin)
function displayPlayerHistory() {
    console.log("กำลังแสดงประวัติการเล่นสำหรับผู้เล่น...");
    
    const historyContainer = document.getElementById('history-container');
    
    if (!historyContainer) {
        console.error("ไม่พบ element 'history-container'");
        return false;
    }
    
    // ดึงประวัติที่กรองแล้ว
    const playerHistoryData = getPlayerHistory();
    
    // แสดงจำนวนรายการประวัติที่กรองแล้ว
    const totalHistoryCount = document.getElementById('total-history-count');
    if (totalHistoryCount) {
        totalHistoryCount.textContent = ` ${playerHistoryData.length}`;
    }
    
    // ซ่อนฟีเจอร์แอดมิน
    toggleHistoryAdminFeatures();
    
    // ถ้าไม่มีประวัติ
    if (playerHistoryData.length === 0) {
        historyContainer.innerHTML = `
            <div class="empty-state">
                <p>ยังไม่มีประวัติการเล่น</p>
                <p>เริ่มเล่นเกมเพื่อบันทึกประวัติ!</p>
            </div>
        `;
        
        // ซ่อนส่วนเพจเนชั่น
        const paginationElement = document.getElementById('history-pagination');
        const perPageElement = document.getElementById('history-items-per-page');
        
        if (paginationElement) paginationElement.style.display = 'none';
        if (perPageElement) perPageElement.style.display = 'none';
        
        return true;
    }
    
    // ใช้ filteredHistory สำหรับระบบ pagination เดิม
    filteredHistory = [...playerHistoryData];
    currentHistoryPage = 1;
    
    // เรียกใช้ฟังก์ชันแสดงผลเดิม
    displayGameHistory();
    
    console.log("แสดงประวัติการเล่นเรียบร้อยแล้ว:", playerHistoryData.length, "รายการ");
    return true;
}

// ฟังก์ชันปรับส่วนหัวของหน้าประวัติตาม User Type - แก้ไขให้ชัดเจนขึ้น
function updateHistoryPageHeader() {
    const historySection = document.querySelector('.history-section .section-header .section-title');
    
    if (historySection) {
        if (isAdminMode && adminProfile) {
            historySection.textContent = 'ประวัติการเล่น (ทั้งหมด - Admin Mode)';
            console.log("อัพเดตหัวข้อประวัติเป็นโหมดแอดมิน");
        } else {
            const playerName = currentPlayer ? currentPlayer.name : 'ผู้เล่น';
            historySection.textContent = `ประวัติการเล่นของ ${playerName}`;
            console.log("อัพเดตหัวข้อประวัติเป็นโหมดผู้เล่น:", playerName);
        }
    } else {
        console.warn("ไม่พบ element สำหรับหัวข้อประวัติ");
    }
}

// ฟังก์ชันแสดงประวัติสำหรับแอดมิน - พร้อม debug
function displayAdminHistory() {
    console.log("กำลังแสดงประวัติการเล่นสำหรับแอดมิน (ทั้งหมด)...");
    
    // **Debug ข้อมูล**
    console.log("Debug gameHistory:", gameHistory.length, "รายการ");
    console.log("Debug gameHistory sample:", gameHistory.slice(0, 2));
    
    const historyContainer = document.getElementById('history-container');
    
    if (!historyContainer) {
        console.error("ไม่พบ element 'history-container'");
        return false;
    }
    
    // แสดงฟีเจอร์แอดมิน (ตัวกรอง, ปุ่มลบ)
    toggleHistoryAdminFeatures();
    
    // **แก้ไขสำคัญ: ตรวจสอบข้อมูลก่อนใช้**
    if (!Array.isArray(gameHistory)) {
        console.error("gameHistory ไม่ใช่ array:", typeof gameHistory);
        gameHistory = [];
    }
    
    // ใช้ข้อมูลประวัติทั้งหมดสำหรับแอดมิน
    filteredHistory = [...gameHistory];
    currentHistoryPage = 1;
    
    console.log("Admin กำลังดูประวัติทั้งหมด:", filteredHistory.length, "รายการ");
    console.log("filteredHistory sample:", filteredHistory.slice(0, 2));
    
    // แสดงจำนวนรายการประวัติทั้งหมด
    const totalHistoryCount = document.getElementById('total-history-count');
    if (totalHistoryCount) {
        totalHistoryCount.textContent = ` ${filteredHistory.length}`;
    }
    
    // เรียกใช้ฟังก์ชันแสดงผลเดิม
    displayGameHistory();
    
    console.log("แสดงประวัติการเล่นสำหรับแอดมินเรียบร้อยแล้ว:", filteredHistory.length, "รายการ");
    return true;
}

// ฟังก์ชันซ่อน/แสดงฟีเจอร์แอดมินในหน้าประวัติ - แก้ไขให้ชัดเจนขึ้น
function toggleHistoryAdminFeatures() {
    console.log("กำลังตั้งค่าฟีเจอร์ประวัติสำหรับ", isAdminMode ? "Admin" : "Player");
    
    // ซ่อน/แสดงส่วนตัวกรอง
    const filterSection = document.querySelector('.history-filter-section');
    if (filterSection) {
        if (isAdminMode && adminProfile) {
            filterSection.style.display = 'block';
            console.log("แสดงส่วนตัวกรองสำหรับ Admin");
        } else {
            filterSection.style.display = 'none';
            console.log("ซ่อนส่วนตัวกรองสำหรับ Player");
        }
    }
    
    // ซ่อน/แสดงปุ่มลบประวัติทั้งหมด
    const clearAllBtn = document.getElementById('clear-all-history');
    if (clearAllBtn) {
        if (isAdminMode && adminProfile) {
            clearAllBtn.style.display = 'inline-block';
            console.log("แสดงปุ่มลบประวัติทั้งหมดสำหรับ Admin");
        } else {
            clearAllBtn.style.display = 'none';
            console.log("ซ่อนปุ่มลบประวัติทั้งหมดสำหรับ Player");
        }
    }
    
    // ซ่อน/แสดงปุ่มลบรายการ
    const deleteButtons = document.querySelectorAll('.delete-history-btn');
    deleteButtons.forEach(btn => {
        if (isAdminMode && adminProfile) {
            btn.style.display = 'inline-block';
        } else {
            btn.style.display = 'none';
        }
    });
    
    // จัดการตัวเลือกจำนวนรายการต่อหน้า
    const itemsPerPageContainer = document.getElementById('history-items-per-page');
    if (itemsPerPageContainer) {
        if (isAdminMode && adminProfile) {
            itemsPerPageContainer.style.display = 'flex';
            console.log("แสดงตัวเลือกจำนวนรายการต่อหน้าสำหรับ Admin");
        } else {
            // ผู้เล่นธรรมดาใช้ค่าเริ่มต้น 10 รายการ และซ่อนตัวเลือก
            historyItemsPerPage = 10;
            itemsPerPageContainer.style.display = 'none';
            console.log("ซ่อนตัวเลือกจำนวนรายการสำหรับ Player และตั้งค่าเป็น 10");
        }
    }
    
    console.log("ตั้งค่าฟีเจอร์ประวัติเรียบร้อยแล้ว");
}

// ฟังก์ชัน Debug สถานะ Admin (ใช้ชั่วคราวเพื่อตรวจสอบปัญหา)
function debugAdminStatus() {
    console.log("=== Debug Admin Status ===");
    console.log("isAdminMode:", isAdminMode);
    console.log("adminProfile:", adminProfile);
    console.log("currentUser:", currentUser);
    console.log("currentPlayer:", currentPlayer);
    console.log("========================");
}

// ฟังก์ชันบังคับรีเซ็ตสถานะผู้เล่นธรรมดา
function forcePlayerMode() {
    if (!adminProfile) { // เฉพาะกรณีที่ไม่ใช่แอดมินจริง
        isAdminMode = false;
        currentUser = null;
        
        // อัพเดตแท็บ
        updateAdminTabs();
        
        // ลบ Admin UI (ถ้ามี)
        removeAdminUI();
        
        console.log("บังคับรีเซ็ตเป็นโหมดผู้เล่นธรรมดา");
    }
}

// ฟังก์ชันตรวจสอบสถานะ Admin ตลอดเวลา (เรียกทุก 3 วินาที)
function startAdminStatusMonitor() {
    setInterval(() => {
        // ถ้าไม่มี adminProfile แต่ isAdminMode เป็น true = ผิดปกติ
        if (isAdminMode && !adminProfile) {
            console.warn("⚠️ ตรวจพบสถานะผิดปกติ: isAdminMode=true แต่ไม่มี adminProfile");
            forcePlayerMode();
        }
        
        // ถ้ามี currentPlayer แต่ไม่ใช่แอดมิน แต่ isAdminMode เป็น true = ผิดปกติ
        if (currentPlayer && !adminProfile && isAdminMode) {
            console.warn("⚠️ ตรวจพบสถานะผิดปกติ: ผู้เล่นธรรมดาถูกตั้งเป็น Admin");
            forcePlayerMode();
        }
        
        // *** เพิ่มการป้องกันใหม่: บังคับล็อกเอาท์ admin session เมื่อมีผู้เล่น ***
        if (currentPlayer && !isAdminMode) {
            forceAdminLogoutForPlayer();
        }
    }, 3000); // ตรวจสอบทุก 3 วินาที (ลดจาก 5 วินาที)
}

// ฟังก์ชันบังคับล็อกเอาท์ admin เมื่อมีผู้เล่นธรรมดา
async function forceAdminLogoutForPlayer() {
    if (currentPlayer && !isAdminMode) {
        try {
            console.log("🔄 บังคับล็อกเอาท์ admin session เพื่อรักษาสถานะผู้เล่น");
            await supabaseClient.auth.signOut();
            
            // ตรวจสอบให้แน่ใจว่าไม่เป็น admin
            isAdminMode = false;
            currentUser = null;
            adminProfile = null;
            
            console.log("✅ ล็อกเอาท์ admin session สำเร็จ");
        } catch (error) {
            console.log("ℹ️ ไม่มี admin session ที่ต้องล็อกเอาท์");
        }
    }
}

// ฟังก์ชันแสดงข้อความแจ้งเตือน - ตรวจสอบให้แน่ใจว่ามีฟังก์ชัน
function showAdminNotification(message) {
    // ลบการแจ้งเตือนเก่า (ถ้ามี)
    const existingNotification = document.getElementById('admin-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // สร้างการแจ้งเตือนใหม่
    const notification = document.createElement('div');
    notification.id = 'admin-notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(45deg, #4caf50, #81c784);
        color: white;
        padding: 12px 24px;
        border-radius: 25px;
        font-weight: 600;
        font-size: 16px;
        box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
        z-index: 10001;
        animation: slideDown 0.3s ease;
    `;
    notification.textContent = message;
    
    // เพิ่มเข้าไปในหน้าเว็บ
    document.body.appendChild(notification);
    
    // ซ่อนหลังจาก 3 วินาที
    setTimeout(() => {
        if (notification && notification.parentNode) {
            notification.style.animation = 'slideDown 0.3s ease reverse';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }
    }, 3000);
    
    console.log("แสดงการแจ้งเตือน:", message);
}

function formatDateTime24Hour(dateString) {
    // บังคับให้ข้อมูลเป็น UTC โดยเพิ่ม Z ถ้าไม่มี
    let utcDateString = dateString;
    if (!dateString.endsWith('Z') && !dateString.includes('+')) {
        utcDateString = dateString + 'Z';
    }
    
    // สร้าง Date object (จะแปลง UTC เป็น local time)
    const date = new Date(utcDateString);
    
    if (isNaN(date.getTime())) {
        return { date: 'Invalid Date', time: 'Invalid Time', full: 'Invalid Date' };
    }
    
    // ใช้ getHours(), getMinutes() (จะได้เวลา local ที่ถูกต้อง)
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return {
        date: `${day}/${month}/${year}`,
        time: `${hours}:${minutes}`,
        full: `${day}/${month}/${year} ${hours}:${minutes}`
    };
}

// ตัวแปรสำหรับเก็บสถานะผู้ใช้
let userMode = null; // 'guest', 'user', 'admin'

// ฟังก์ชันเลือกตัวเลือกในหน้าต้อนรับ
function selectWelcomeOption(option) {
  console.log('เลือกตัวเลือก:', option);
  
  switch(option) {
    case 'guest':
      showGuestForm();
      break;
    case 'login':
      showLoginForm();
      break;
    case 'register':
      showRegisterForm();
      break;
  }
}

// แสดงฟอร์มชื่อผู้เล่น Guest
function showGuestForm() {
  document.getElementById('guest-name-form').classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('guest-name-input').focus();
  }, 100);
}

// ปิดฟอร์ม Guest
function closeGuestForm() {
  document.getElementById('guest-name-form').classList.add('hidden');
  document.getElementById('guest-name-input').value = '';
}

// เริ่มโหมด Guest
function startGuestMode() {
  const guestName = document.getElementById('guest-name-input').value.trim();
  
  if (!guestName) {
    alert('กรุณากรอกชื่อผู้เล่น');
    return;
  }
  
  // ตั้งค่าโหมด Guest
  userMode = 'guest';
  currentPlayer = {
    name: guestName,
    mode: 'guest',
    loginTime: new Date().toISOString()
  };
  
  console.log('เริ่มโหมด Guest:', currentPlayer);
  
  // ปิด Modal ก่อน
  closeGuestForm();
  
  // ซ่อนหน้าต้อนรับ
  hideWelcomeScreen();
  
  // ไปยังหน้าเลือกหมวดหมู่
  startGameAfterLogin();
}

// แสดงฟอร์มเข้าสู่ระบบ
async function showLoginForm() {
    // *** เพิ่มการตรวจสอบ session ที่มีอยู่ก่อน ***
    const hasExistingSession = await checkExistingSession();
    
    if (hasExistingSession) {
        // มี session อยู่แล้ว ไม่ต้องแสดงฟอร์ม
        console.log("ใช้ session ที่มีอยู่แล้ว");
        return;
    }
    
    // ไม่มี session หรือ session หมดอายุ แสดงฟอร์มล็อกอิน
    document.getElementById('user-login-form').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('login-email').focus();
    }, 100);
}

// ปิดฟอร์มเข้าสู่ระบบ
function closeLoginForm() {
  document.getElementById('user-login-form').classList.add('hidden');
  clearLoginForm();
}

// ล้างฟอร์มเข้าสู่ระบบ
function clearLoginForm() {
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').classList.add('hidden');
}

// ดำเนินการเข้าสู่ระบบ
async function performUserLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errorDiv = document.getElementById('login-error');
  
  // ตรวจสอบข้อมูล
  if (!email || !password) {
    showError('login-error', 'กรุณากรอกอีเมลและรหัสผ่าน');
    return;
  }
  
  try {
    // เข้าสู่ระบบผ่าน Supabase
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });
    
    if (error) {
      throw error;
    }
    
    console.log('เข้าสู่ระบบสำเร็จ:', data.user);
    
    // ตรวจสอบว่าเป็นแอดมินหรือไม่
    const adminData = await checkIsAdmin(data.user.id);
    
    if (adminData) {
      // โหมดแอดมิน
      userMode = 'admin';
      isAdminMode = true;
      adminProfile = adminData;
      currentUser = data.user;
      currentPlayer = {
        name: adminData.name || 'Admin',
        mode: 'admin',
        userId: data.user.id,
        loginTime: new Date().toISOString()
      };
      
      activateAdminMode();
    } else {
      // โหมดผู้ใช้ทั่วไป
      userMode = 'user';
      currentUser = data.user;
      currentPlayer = {
        name: data.user.user_metadata?.display_name || data.user.email.split('@')[0],
        mode: 'user',
        userId: data.user.id,
        loginTime: new Date().toISOString()
      };
    }
    
    // ปิด Modal ก่อน
    closeLoginForm();
    
    // ซ่อนหน้าต้อนรับ
    hideWelcomeScreen();
    
    // ไปยังหน้าเลือกหมวดหมู่
    startGameAfterLogin();
    
  } catch (error) {
    console.error('เข้าสู่ระบบไม่สำเร็จ:', error);
    showError('login-error', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
}

// ฟังก์ชันตรวจสอบ session ที่มีอยู่ (เรียกเฉพาะเมื่อผู้ใช้เลือก Login)
async function checkExistingSession() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        if (session && session.user) {
            console.log("พบ session ที่ล็อกอินอยู่:", session.user.email);
            
            // ตรวจสอบว่าเป็นแอดมินหรือไม่
            const adminData = await checkIsAdmin(session.user.id);
            
            if (adminData) {
                // เป็นแอดมิน
                userMode = 'admin';
                isAdminMode = true;
                adminProfile = adminData;
                currentUser = session.user;
                currentPlayer = {
                    name: adminData.name || 'Admin',
                    mode: 'admin',
                    userId: session.user.id,
                    loginTime: new Date().toISOString()
                };
                
                activateAdminMode();
                hideWelcomeScreenAndStart();
                return true;
            } else {
                // เป็นผู้ใช้ทั่วไป
                userMode = 'user';
                currentUser = session.user;
                currentPlayer = {
                    name: session.user.user_metadata?.display_name || session.user.email.split('@')[0],
                    mode: 'user',
                    userId: session.user.id,
                    loginTime: new Date().toISOString()
                };
                
                hideWelcomeScreenAndStart();
                return true;
            }
        }
        
        return false; // ไม่มี session
        
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการตรวจสอบ session:', error);
        return false;
    }
}

// แสดงฟอร์มสมัครสมาชิก
function showRegisterForm() {
  document.getElementById('user-register-form').classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('register-name').focus();
  }, 100);
}

// ปิดฟอร์มสมัครสมาชิก
function closeRegisterForm() {
  document.getElementById('user-register-form').classList.add('hidden');
  clearRegisterForm();
}

// ล้างฟอร์มสมัครสมาชิก
function clearRegisterForm() {
  document.getElementById('register-name').value = '';
  document.getElementById('register-email').value = '';
  document.getElementById('register-password').value = '';
  document.getElementById('register-confirm-password').value = '';
  document.getElementById('accept-terms').checked = false;
  document.getElementById('register-error').classList.add('hidden');
}

// ดำเนินการสมัครสมาชิก
async function performUserRegister() {
  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value.trim();
  const confirmPassword = document.getElementById('register-confirm-password').value.trim();
  const acceptTerms = document.getElementById('accept-terms').checked;
  
  // ตรวจสอบข้อมูล
  if (!name || !email || !password || !confirmPassword) {
    showError('register-error', 'กรุณากรอกข้อมูลให้ครบทุกช่อง');
    return;
  }
  
  if (password !== confirmPassword) {
    showError('register-error', 'รหัสผ่านไม่ตรงกัน');
    return;
  }
  
  if (password.length < 6) {
    showError('register-error', 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    return;
  }
  
  if (!acceptTerms) {
    showError('register-error', 'กรุณายอมรับเงื่อนไขการใช้งาน');
    return;
  }
  
  try {
    // สมัครสมาชิกผ่าน Supabase
    const { data, error } = await supabaseClient.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          display_name: name
        }
      }
    });
    
    if (error) {
      throw error;
    }
    
    console.log('สมัครสมาชิกสำเร็จ:', data.user);
    
    // ตั้งค่าผู้ใช้
    userMode = 'user';
    currentUser = data.user;
    currentPlayer = {
      name: name,
      mode: 'user',
      userId: data.user.id,
      loginTime: new Date().toISOString()
    };
    
    alert('สมัครสมาชิกสำเร็จ! ยินดีต้อนรับ');
    
    // ปิด Modal ก่อน
    closeRegisterForm();
    
    // ซ่อนหน้าต้อนรับ
    hideWelcomeScreen();
    
    // ไปยังหน้าเลือกหมวดหมู่
    startGameAfterLogin();
    
  } catch (error) {
    console.error('สมัครสมาชิกไม่สำเร็จ:', error);
    let errorMessage = 'เกิดข้อผิดพลาดในการสมัครสมาชิก';
    
    if (error.message.includes('already registered')) {
      errorMessage = 'อีเมลนี้ถูกใช้งานแล้ว';
    }
    
    showError('register-error', errorMessage);
  }
}

// แสดงข้อผิดพลาด
function showError(elementId, message) {
  const errorDiv = document.getElementById(elementId);
  errorDiv.textContent = message;
  errorDiv.classList.remove('hidden');
}

// ซ่อนหน้าต้อนรับ
function hideWelcomeScreen() {
  const welcomeScreen = document.getElementById('welcome-screen');
  if (welcomeScreen) {
    welcomeScreen.style.opacity = '0';
    setTimeout(() => {
      welcomeScreen.classList.add('hidden');
    }, 300);
  }
}

// เริ่มเกมหลังจากเข้าสู่ระบบ
function startGameAfterLogin() {
  // ซ่อนหน้า login เดิม
  const oldLoginScreen = document.getElementById('login-screen');
  if (oldLoginScreen) {
    oldLoginScreen.classList.add('hidden');
  }
  
  // แสดงหน้าเลือกหมวดหมู่
  const startScreen = document.getElementById('start-screen');
  const categorySelection = document.getElementById('category-selection-container');
  
  if (startScreen) startScreen.classList.remove('hidden');
  if (categorySelection) categorySelection.classList.remove('hidden');
  
  // อัพเดต UI ตามโหมด
  updateUIForUserMode();
  
  console.log('เริ่มเกมในโหมด:', userMode);
}

// อัพเดต UI ตามโหมดผู้ใช้
function updateUIForUserMode() {
  // อัพเดตแท็บ
  updateAdminTabs();
  
  // เพิ่มข้อมูลผู้เล่นที่มุมขวาบน
  const quizContainer = document.querySelector('.container.quiz-player');
  if (quizContainer && currentPlayer) {
    // ลบข้อมูลเก่า
    const existingInfo = quizContainer.querySelector('.player-info.top-right');
    if (existingInfo) existingInfo.remove();
    
    // เพิ่มข้อมูลใหม่
    const playerInfo = document.createElement('div');
    playerInfo.className = 'player-info top-right';
    
    let modeIcon = '';
    switch(userMode) {
      case 'guest': modeIcon = '👤'; break;
      case 'user': modeIcon = '🔑'; break;
      case 'admin': modeIcon = '👑'; break;
    }
    
    playerInfo.innerHTML = `
      <div class="player-name">${modeIcon} ${currentPlayer.name}</div>
    `;
    quizContainer.appendChild(playerInfo);
  }
}

// Event Listeners สำหรับ Enter key
document.addEventListener('DOMContentLoaded', function() {
  // Guest name input
  const guestInput = document.getElementById('guest-name-input');
  if (guestInput) {
    guestInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        startGuestMode();
      }
    });
  }
  
  // Login form
  const loginPassword = document.getElementById('login-password');
  if (loginPassword) {
    loginPassword.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        performUserLogin();
      }
    });
  }
  
  // Register form
  const registerConfirmPassword = document.getElementById('register-confirm-password');
  if (registerConfirmPassword) {
    registerConfirmPassword.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        performUserRegister();
      }
    });
  }
});

// ฟังก์ชันตรวจสอบและโหลดประวัติการเล่นตามโหมด
async function loadUserGameHistory() {
    if (userMode === 'guest') {
        // Guest: ใช้ประวัติในหน่วยความจำเท่านั้น
        gameHistory = [];
        filteredHistory = [];
        console.log("โหมด Guest: เริ่มต้นประวัติเปล่า");
    } else if (userMode === 'user' || userMode === 'admin') {
        // User/Admin: โหลดจาก Database
        await loadGameHistory();
        console.log("โหลดประวัติจาก Database:", gameHistory.length, "รายการ");
    }
}

// ฟังก์ชันบันทึกประวัติการเล่นตามโหมด
async function saveUserGameHistory(player, score, totalQuestions, category, percentage) {
    if (userMode === 'guest') {
        // Guest: เก็บในหน่วยความจำเท่านั้น
        const historyEntry = {
            id: Date.now().toString(),
            playerName: player.name,
            score: score,
            totalQuestions: totalQuestions,
            percentage: percentage,
            category: category,
            playedAt: new Date().toISOString(),
            gameData: {
                questions: [...currentGameQuestions],
                userAnswers: {...userAnswers},
                randomOrder: [...randomQuestionOrder],
                choiceOrder: {...choiceOrderMap}
            }
        };
        
        gameHistory.unshift(historyEntry);
        filteredHistory = [...gameHistory];
        
        console.log("Guest: บันทึกประวัติในหน่วยความจำ");
        return true;
    } else {
        // User/Admin: บันทึกลง Database
        return await addGameHistoryEntry(player, score, totalQuestions, category, percentage);
    }
}

// ฟังก์ชันออกจากระบบ
async function logout() {
    if (userMode === 'user' || userMode === 'admin') {
        // ออกจาก Supabase Auth
        await supabaseClient.auth.signOut();
    }
    
    // รีเซ็ตตัวแปรทั้งหมด
    currentPlayer = null;
    currentUser = null;
    userMode = null;
    isAdminMode = false;
    adminProfile = null;
    
    // ล้างประวัติ
    gameHistory = [];
    filteredHistory = [];
    
    // รีเซ็ต UI
    removeAdminUI();
    updateAdminTabs();
    
    // กลับไปหน้าต้อนรับ
    location.reload();
}

// ฟังก์ชันบังคับล็อกเอาท์ session ทั้งหมด
async function forceLogoutAllSessions() {
    try {
        console.log("กำลังล็อกเอาท์ session ทั้งหมด...");
        
        // ล็อกเอาท์จาก Supabase
        await supabaseClient.auth.signOut();
        
        // รีเซ็ตตัวแปรทั้งหมด
        currentPlayer = null;
        currentUser = null;
        userMode = null;
        isAdminMode = false;
        adminProfile = null;
        
        // ล้างประวัติ
        gameHistory = [];
        filteredHistory = [];
        
        // รีเซ็ต UI
        removeAdminUI();
        updateAdminTabs();
        
        console.log("ล็อกเอาท์ทุก session เรียบร้อยแล้ว");
        
        // แสดงหน้าต้อนรับใหม่
        showWelcomeScreen();
        
        return true;
        
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการล็อกเอาท์:', error);
        return false;
    }
}
