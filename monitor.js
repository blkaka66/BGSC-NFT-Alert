require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

// ----------------------------------
// 상수 선언
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = 5000;
const TARGET_URL = "https://bugsnft.com/exchange";
// 등급 배열
const GRADES = ["골드", "플래티넘", "다이아몬드"];
// 알림 기준 가격
const PRICE_THRESHOLD = 1_000_000;

let browser, page;
const notified = {};

// ----------------------------------
// Telegram 메시지 전송
async function sendTelegramMessage(message) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: message }
    );
  } catch (err) {
    console.error("텔레그램 전송 오류:", err.message);
  }
}

// ----------------------------------
// 필터 모달 열기
async function openFilterModal() {
  await page.click("button.metallic-button");
  console.log("✔️ 필터 버튼 클릭됨");

  // wcm-modal 안에 '골드' 버튼이 렌더링될 때까지 순수 DOM으로 대기
  await page.waitForFunction(
    () => {
      const modal = document.querySelector("wcm-modal");
      if (!modal) return false;
      return Array.from(modal.querySelectorAll("button")).some(
        (b) => b.textContent.trim() === "골드"
      );
    },
    { timeout: 10000 }
  );
  console.log("✔️ 필터 모달 열림");
}

// ----------------------------------
// 희귀도 버튼 클릭
async function clickRarityFilter(label) {
  await page.evaluate((lbl) => {
    const modal = document.querySelector("wcm-modal");
    if (!modal) return;
    const btn = Array.from(modal.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === lbl
    );
    btn?.click();
  }, label);
  console.log(`✔️ "${label}" 버튼 클릭됨`);
}

// ----------------------------------
// 한 사이클 검사
async function checkOnce() {
  console.log("🚀 checkOnce 시작");
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });

    for (const grade of GRADES) {
      console.log(`▶️ ${grade} 검사 시작`);

      // 1) 모달 열기
      await openFilterModal();

      // 2) 버튼 클릭
      await clickRarityFilter(grade);

      // 3) 첫 매물이 로드될 때까지 기다리기 (순수 DOM)
      await page.waitForFunction(
        () =>
          !!document.querySelector(
            ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span"
          ),
        { timeout: 10000 }
      );

      // 4) 첫 매물 가격 읽어오기
      const priceText = await page.$eval(
        ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span.text-base.font-bold", // 수정된 셀렉터
        (el) => el.textContent.replace(/[^0-9]/g, "")
      );
      const price = parseInt(priceText, 10);
      console.log(`🔖 ${grade} 첫 매물 가격: ${price.toLocaleString()} BGSC`);

      // 5) 기준 이하이면 알림
      if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
        const msg = `[알림] ${grade} 등급 첫 매물 ${price.toLocaleString()} BGSC 감지됨`;
        await sendTelegramMessage(msg);
        notified[grade] = price;
        break; // 하나 알림 보냈으면 다음 사이클까지 대기
      }
    }
  } catch (e) {
    console.error("❌ 체크 중 오류:", e);
  }
}

// ----------------------------------
// IIFE: 초기 실행 + 주기 실행
(async () => {
  console.log("3. IIFE 시작"); // 추가
  console.log("🛠️ 모니터링 서비스 시작");
  try {
    // try-catch로 감싸서 오류 확인
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu", // GPU 사용 안 함
        "--disable-dev-shm-usage", // /dev/shm 메모리 사용량 줄임
        "--no-zygote", // 컨테이너 환경에서 유용
        "--single-process", // 컨테이너 환경에서 유용
      ],
    });
    console.log("4. Puppeteer 브라우저 런칭 성공"); // 추가
    page = await browser.newPage();
    console.log("5. 새로운 페이지 생성 성공"); // 추가

    await checkOnce();
    console.log("6. 첫 checkOnce 실행 완료"); // 추가

    setInterval(async () => {
      console.log("⏰ 주기적 체크 시작");
      await checkOnce();
    }, CHECK_INTERVAL_MS);
  } catch (e) {
    console.error("❌ 초기화 또는 실행 중 치명적인 오류 발생:", e); // 오류를 더 자세히 출력
    if (browser) await browser.close(); // 브라우저가 열렸다면 닫기
  }
})();
