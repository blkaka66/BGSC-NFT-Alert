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
// '브론즈', '실버' 제외하고 '골드', '플래티넘', '다이아몬드'만 포함
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
// 필터 모달 열기 (이제는 단순히 필터 버튼 클릭만 담당)
async function openFilterModal() {
  await page.click("button.metallic-button");
  console.log("✔️ 필터 버튼 클릭됨");
  // 모달이 열리는 데 약간의 딜레이를 줍니다 (필요시)
  // await page.waitForTimeout(500); // <-- 이 부분을 수정합니다.
  await new Promise((r) => setTimeout(r, 500)); // 0.5초 대기
  console.log("✔️ 필터 버튼 클릭 후 대기 완료"); // 로그 추가
}
// ----------------------------------
// 희귀도 버튼 클릭 (버튼이 나타날 때까지 기다리는 로직 추가)
async function clickRarityFilter(label) {
  // 이제 page.evaluate 대신 Puppeteer의 waitForFunction을 사용하여 버튼이 DOM에 나타날 때까지 기다립니다.
  await page.waitForFunction(
    (lbl) => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.some(
        (b) => b.textContent.trim() === lbl && b.offsetParent !== null // offsetParent !== null은 요소가 실제로 보이는지 확인
      );
    },
    { timeout: 10000 }, // 버튼이 나타날 때까지 10초 대기
    label
  );
  console.log(`✔️ "${label}" 버튼이 DOM에 나타남`);

  // 버튼이 나타나면 클릭
  await page.evaluate((lbl) => {
    const btn = Array.from(document.querySelectorAll("button")).find(
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

      // 1) 필터 모달 열기 (실제로는 필터 버튼 클릭)
      await openFilterModal();

      // 2) 등급 버튼 클릭 (버튼이 나타나기를 기다림)
      await clickRarityFilter(grade);

      // 필터링 적용 후 페이지가 업데이트될 시간을 줍니다.
      // await page.waitForTimeout(1000); // <-- 이 부분을 수정합니다.
      await new Promise((r) => setTimeout(r, 1000)); // 1초 대기

      // 3) 첫 매물이 로드될 때까지 기다리기 (순수 DOM)
      await page.waitForFunction(
        () =>
          !!document.querySelector(
            ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span"
          ),
        { timeout: 30000 } // 여전히 30초 대기
      );
      console.log("✔️ 첫 매물 로드됨"); // 로그 추가

      // ... (생략) ...
    }
  } catch (e) {
    console.error("❌ 체크 중 오류:", e);
  }
}

// ----------------------------------
// IIFE: 초기 실행 + 주기 실행
(async () => {
  console.log("3. IIFE 시작");
  console.log("🛠️ 모니터링 서비스 시작");
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-zygote",
        "--single-process",
      ],
    });
    console.log("4. Puppeteer 브라우저 런칭 성공");
    page = await browser.newPage();
    console.log("5. 새로운 페이지 생성 성공");

    await checkOnce();
    console.log("6. 첫 checkOnce 실행 완료");

    setInterval(async () => {
      console.log("⏰ 주기적 체크 시작");
      await checkOnce();
    }, CHECK_INTERVAL_MS);
  } catch (e) {
    console.error("❌ 초기화 또는 실행 중 치명적인 오류 발생:", e);
    if (browser) await browser.close();
  }
})();
