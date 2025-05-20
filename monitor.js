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
    await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text: message });
  } catch (err) {
    console.error("텔레그램 전송 실패:", err.message);
  }
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function clickFilterButton() {
  return await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (el) => el.textContent.trim() === "필터"
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
}

async function clickGradeButton(label) {
  return await page.evaluate((grade) => {
    const btn = [...document.querySelectorAll("button")].find(
      (el) => el.textContent.trim() === grade
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
}

async function checkPricesAndNotify(grade) {
  const prices = await page.evaluate(() => {
    return [...document.querySelectorAll(".enhanced-nft-price span")]
      .map((el) => el.textContent.trim())
      .filter((text) => text.includes("BGSC"))
      .map((text) => {
        const price = parseInt(text.replace(/[^0-9]/g, ""), 10);
        return isNaN(price) ? null : price;
      })
      .filter((price) => price !== null);
  });

  for (const price of prices) {
    console.log(price)
    if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
      const msg = `[알림] ${grade} 등급 NFT 가격 ${price.toLocaleString()} BGSC 이하 감지됨`;
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

    if (!(await clickFilterButton())) {
      console.warn("필터 버튼 클릭 실패");
      return;
    }

    await delay(1000);

    for (const grade of GRADES) {
      const clicked = await clickGradeButton(grade);
      console.log(clicked ? `${grade} 클릭됨` : `${grade} 버튼 클릭 실패`);
      if (!clicked) continue;

      await delay(2000);

      const found = await checkPricesAndNotify(grade);
      if (found) return;
    }
  } catch (err) {
    console.error("에러 발생:", err.message);
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
