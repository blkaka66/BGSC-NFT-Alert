require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TARGET_URL = "https://bugsnft.com/exchange";
const CHECK_INTERVAL = 3000; // 3초마다
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 10_000_000; // 10,000,000 BGSC 이하

let browser, page;
const notified = {}; // { grade: lastNotifiedPrice }

/** Telegram 메시지 전송 */
async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text });
  } catch (e) {
    console.error("텔레그램 전송 오류:", e.message);
  }
}

/** 간단한 대기 */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** “필터” 토글 클릭 */
async function clickFilterToggle() {
  const ok = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "필터"
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log(ok ? "✔️ 필터 토글 클릭" : "⚠️ 필터 토글 클릭 실패");
  return ok;
}

/** 등급 버튼(text) 찾아서 클릭 */
async function clickGradeButton(label) {
  const clicked = await page.evaluate((label) => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === label
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
  console.log(
    clicked ? `✔️ "${label}" 버튼 클릭됨` : `⚠️ "${label}" 버튼 클릭 실패`
  );
  return clicked;
}

/** 화면에 표시된 가격들 중 임계치 이하 있으면 Telegram 알림 */
async function checkPricesAndNotify(grade) {
  const prices = await page.$$eval(".enhanced-nft-price span", (spans) =>
    spans
      .map((s) => s.textContent.trim())
      .filter((t) => t.includes("BGSC"))
      .map((t) => parseInt(t.replace(/[^0-9]/g, ""), 10))
  );

  for (const price of prices) {
    if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
      const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 감지됨`;
      await sendTelegramMessage(msg);
      console.log(msg);
      notified[grade] = price;
      return true;
    }
  }
  return false;
}

/** 한 사이클 검사 */
async function checkOnce() {
  try {
    await page.goto(TARGET_URL, {
      waitUntil: "networkidle2",
      timeout: 0,
    });

    // 1) 필터 열기
    if (!(await clickFilterToggle())) return;
    await delay(800);

    // 2) 골드 → 플래티넘 → 다이아몬드 순으로 클릭 & 가격 체크
    for (const grade of GRADES) {
      if (!(await clickGradeButton(grade))) continue;
      await delay(1200);
      if (await checkPricesAndNotify(grade)) return;
    }
  } catch (e) {
    console.error("체크 중 오류:", e);
  }
}

(async () => {
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  // 첫 실행
  await checkOnce();
  // 이후 주기 실행
  setInterval(checkOnce, CHECK_INTERVAL);
})();
