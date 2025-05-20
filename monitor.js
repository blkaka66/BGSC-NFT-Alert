require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const CHECK_INTERVAL = 3000;
const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 10_000_000;

let browser, page;
const notified = {};

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
  } catch (err) {
    console.error("텔레그램 메시지 전송 실패:", err.message);
  }
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function clickFilterToggle() {
  return await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "필터"
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
}

async function clickGradeButton(grade) {
  return await page.evaluate((grade) => {
    const h2 = Array.from(document.querySelectorAll("h2")).find((el) =>
      el.textContent.includes("희귀도 필터")
    );
    if (!h2 || !h2.nextElementSibling) return false;

    const buttons = Array.from(
      h2.nextElementSibling.querySelectorAll("button")
    );
    const target = buttons.find((btn) => btn.textContent.trim() === grade);
    if (target) {
      target.click();
      return true;
    }
    return false;
  }, grade);
}

async function checkPricesAndNotify(grade) {
  const prices = await page.$$eval(".enhanced-nft-price span", (spans) =>
    spans
      .map((span) => span.textContent.trim())
      .filter((txt) => txt.includes("BGSC"))
      .map((txt) => parseInt(txt.replace(/[^0-9]/g, ""), 10))
  );

  for (const price of prices) {
    if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
      const msg = `[감지됨] ${grade} 등급 NFT 가격 ${price.toLocaleString()} BGSC 이하`;
      await sendTelegramMessage(msg);
      notified[grade] = price;
      console.log(msg);
      return true;
    }
  }
  return false;
}

async function checkOnce() {
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });

    const filterOk = await clickFilterToggle();
    if (!filterOk) {
      console.warn("필터 버튼 클릭 실패");
      return;
    }
    await delay(1000);

    for (const grade of GRADES) {
      const clicked = await clickGradeButton(grade);
      if (!clicked) {
        console.warn(`${grade} 버튼 클릭 실패`);
        continue;
      }

      await delay(2000);

      const found = await checkPricesAndNotify(grade);
      if (found) return;
    }
  } catch (err) {
    console.error("오류 발생:", err.message);
  }
}

(async () => {
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  await checkOnce();
  setInterval(checkOnce, CHECK_INTERVAL);
})();
