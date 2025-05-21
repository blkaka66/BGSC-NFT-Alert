require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL = 3000; // 3초
const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 10_000_000; // 10,000,000 BGSC 이하 알림

let browser, page;
const notified = {}; // { grade: lastNotifiedPrice }

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text: message });
  } catch (err) {
    console.error("텔레그램 전송 오류:", err.message);
  }
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function clickFilterToggle() {
  const ok = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "필터"
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log(ok ? "✔️ 필터 패널 열림" : "⚠️ 필터 패널 열림 실패");
  return ok;
}

async function clickRarityFilter(label) {
  const clicked = await page.evaluate((label) => {
    const h2 = [...document.querySelectorAll("h2")].find((el) =>
      el.textContent.includes("희귀도 필터")
    );
    if (!h2?.nextElementSibling) return false;
    const btn = [...h2.nextElementSibling.querySelectorAll("button")].find(
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

async function checkPricesAndNotify(grade) {
  const prices = await page.$$eval(".enhanced-nft-price span", (spans) =>
    spans
      .map((s) => s.textContent.trim())
      .filter((t) => t.includes("BGSC"))
      .map((t) => parseInt(t.replace(/[^0-9]/g, ""), 10))
  );

  console.log(`${grade} 단계 가격 목록:`, prices);

  for (const price of prices) {
    if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
      const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 감지됨`;
      await sendTelegramMessage(msg);
      notified[grade] = price;
      console.log(msg);
      return true;
    }
  }
  return false;
}

async function checkOnce() {
  await page.goto(TARGET_URL, {
    waitUntil: "networkidle2",
    timeout: 0,
  });

  if (!(await clickFilterToggle())) return;
  await delay(1000);

  for (const grade of GRADES) {
    if (!(await clickRarityFilter(grade))) continue;
    await page.waitForSelector(".enhanced-nft-card", { timeout: 5000 });
    await delay(500);

    const found = await checkPricesAndNotify(grade);
    if (found) {
      console.log("알림 보낸 후 모니터링 종료");
      await browser.close();
      process.exit(0);
    }
  }
}

(async () => {
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  while (true) {
    try {
      await checkOnce();
    } catch (err) {
      console.error("체크 중 오류:", err);
    }
    await delay(CHECK_INTERVAL);
  }
})();
