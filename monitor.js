require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

// ----------------------------------
// 상수 선언
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = 5000;
const TARGET_URL = "https://bugsnft.com/exchange";

// 등급 배열 (인라인 필터 버튼 텍스트와 일치해야 함)
const GRADES = ["골드", "플래티넘", "다이아몬드"];
// 알림 기준 가격
const PRICE_THRESHOLD = 1_000_000;

let browser, page;
const notified = {};

// ----------------------------------
// 함수 정의

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

// 인라인 희귀도 필터 버튼 클릭
async function clickInlineRarityFilter(label) {
  // 필터 패널 헤더가 보일 때까지
  await page.waitForSelector("h2:has-text('희귀도 필터')", { timeout: 5000 });
  // 그 안의 버튼들 중 텍스트가 label 과 일치하는 걸 클릭
  const buttons = await page.$$("div:has(h2:has-text('희귀도 필터')) button");
  for (const btn of buttons) {
    const txt = await page.evaluate((el) => el.textContent.trim(), btn);
    if (txt === label) {
      await btn.click();
      console.log(`✔️ "${label}" 버튼 클릭됨 (인라인 필터)`);
      return;
    }
  }
  throw new Error(`"${label}" 버튼을 찾을 수 없음`);
}

// 첫 매물 가격 파싱
async function getFirstPrice() {
  // 첫 카드의 가격 span 이 렌더링될 때까지
  await page.waitForSelector(
    ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span",
    { timeout: 5000 }
  );
  const txt = await page.$eval(
    ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span",
    (el) => el.textContent
  );
  // "1,195,000 BGSC" 에서 숫자만 추출
  const num = parseInt(txt.replace(/[^0-9]/g, ""), 10);
  if (isNaN(num)) throw new Error(`가격 파싱 실패: "${txt}"`);
  return num;
}

// 한 사이클 검사
async function checkOnce() {
  console.log("🚀 checkOnce 시작");
  try {
    // 페이지 이동
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });

    for (const grade of GRADES) {
      console.log(`▶️ ${grade} 검사`);
      try {
        // 필터 클릭
        await clickInlineRarityFilter(grade);
        // 첫 매물 가격 읽기
        const price = await getFirstPrice();
        console.log(`${grade} 첫 매물 가격: ${price.toLocaleString()} BGSC`);

        // 알림 조건 충족 시 Telegram 전송
        if (
          price > 0 &&
          price <= PRICE_THRESHOLD &&
          notified[grade] !== price
        ) {
          const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 감지됨`;
          await sendTelegramMessage(msg);
          notified[grade] = price;
          break; // 낮은 등급부터 순서대로 검사하므로, 알림 후 루프 탈출
        }
      } catch (e) {
        console.error(`${grade} 검사 중 오류:`, e.message);
      }
    }
  } catch (e) {
    console.error("checkOnce 전체 오류:", e);
  }
}

// ----------------------------------
// IIFE: 초기 실행 + 주기 실행
(async () => {
  console.log("🛠️ 모니터링 서비스 시작");
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  // 초기 한 번
  await checkOnce();

  // 이후 주기적 실행
  setInterval(async () => {
    console.log("⏰ 주기적 체크 시작");
    await checkOnce();
  }, CHECK_INTERVAL_MS);
})();
