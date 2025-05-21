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

// 필터 모달 열기
async function openFilterModal() {
  // (1) “필터” 텍스트를 가진 버튼만 클릭
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "필터"
    );
    if (!btn) throw new Error("필터 버튼을 찾을 수 없음");
    btn.click();
  });
  console.log("✔️ 필터 버튼 클릭됨");

  // (2) 페이지 전체에서 “골드” 버튼이 보일 때까지 대기
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("button")).some(
        (b) => b.textContent.trim() === "골드"
      ),
    { timeout: 10000 }
  );
  console.log("✔️ 필터 모달 열림 (골드 버튼 확인)");
}

// 모달에서 등급 버튼 클릭
async function clickRarityFilter(label) {
  await page.evaluate((lbl) => {
    const modal = document.querySelector("wcm-modal");
    if (!modal) return;
    const btn = Array.from(modal.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === lbl
    );
    btn?.click();
  }, label);
  console.log(`${label} 버튼 클릭됨`);
}

// 그리드 끝까지 스크롤
async function scrollGridToEnd() {
  await page.evaluate(async () => {
    const grid = document.querySelector(
      ".grid.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-3.xl\\:grid-cols-4"
    );
    if (!grid) return;
    let prev;
    do {
      prev = grid.scrollHeight;
      grid.scrollTop = prev;
      await new Promise((r) => setTimeout(r, 500));
    } while (grid.scrollHeight !== prev);
  });
  console.log("그리드 끝까지 스크롤 완료");
}

// 가격 검사 후 알림
async function checkPricesAndNotify(grade) {
  const prices = await page.$$eval(
    ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span",
    (els) =>
      els
        .map((el) => el.textContent.replace(/[^0-9]/g, ""))
        .filter((txt) => txt)
        .map((txt) => parseInt(txt, 10))
  );
  console.log(`${grade} 단계 가격 목록:`, prices);

  for (const price of prices) {
    if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
      const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 감지됨`;
      await sendTelegramMessage(msg);
      notified[grade] = price;
      return true;
    }
  }
  return false;
}

// 한 사이클 검사
async function checkOnce() {
  console.log("checkOnce 시작");
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });
    await openFilterModal();

    for (const grade of GRADES) {
      await clickRarityFilter(grade);
      await scrollGridToEnd();
      const notifiedNow = await checkPricesAndNotify(grade);
      if (notifiedNow) break;
      await openFilterModal();
    }
  } catch (e) {
    console.error("체크 중 오류:", e);
  }
}

// ----------------------------------
// IIFE: 초기 실행 + 주기 실행
(async () => {
  console.log("모니터링 서비스 시작");
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  // 초기 한 번
  await checkOnce();
  // 이후 주기적
  setInterval(async () => {
    console.log("주기적 체크 시작");
    await checkOnce();
  }, CHECK_INTERVAL_MS);
})();
