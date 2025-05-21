require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL = 3000; // 3초마다
const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 10_000_000; // 10,000,000 BGSC 이하 알림

let browser, page;
const notified = {}; // { grade: lastNotifiedPrice }

/** Telegram 메시지 전송 */
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

/** 간단한 딜레이 */
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/** 필터 패널이 열려 있지 않으면 열기 */
async function ensureFilterOpen() {
  const isOpen = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("h2")).some((el) =>
      el.textContent.trim().includes("희귀도 필터")
    );
  });

  if (!isOpen) {
    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent.trim() === "필터"
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log(clicked ? "✔️ 필터 패널 열림" : "⚠️ 필터 버튼 없음");
  } else {
    console.log("✔️ 필터 패널 이미 열림");
  }
}

/** 희귀도 필터에서 해당 등급 버튼 클릭 */
async function clickRarityFilter(label) {
  const clicked = await page.evaluate((label) => {
    const h2 = Array.from(document.querySelectorAll("h2")).find((el) =>
      el.textContent.trim().includes("희귀도 필터")
    );
    if (!h2 || !h2.nextElementSibling) return false;

    for (const btn of h2.nextElementSibling.querySelectorAll("button")) {
      if (btn.textContent.trim() === label) {
        btn.click();
        return true;
      }
    }
    return false;
  }, label);

  console.log(
    clicked ? `✔️ "${label}" 버튼 클릭됨` : `⚠️ "${label}" 버튼 클릭 실패`
  );
  return clicked;
}

/** 화면에 표시된 NFT 가격 중 임계치 이하가 있으면 알림 */
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
      notified[grade] = price;
      console.log(msg);
      return true;
    }
  }
  return false;
}

/** 한 사이클 검사 */
async function checkOnce() {
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });

    // 1) 필터 패널 열기 (페이지 로드 후마다)
    await ensureFilterOpen();
    await delay(1000);

    // 2) 등급별 순회
    for (const grade of GRADES) {
      if (!(await clickRarityFilter(grade))) continue;
      await delay(2000);

      if (await checkPricesAndNotify(grade)) {
        // 알림 보냈으면 이 사이클 종료
        return;
      }
    }
  } catch (err) {
    console.error("체크 중 오류:", err.message);
  }
}

(async () => {
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  // 초기 실행
  await checkOnce();
  // 주기 실행
  setInterval(checkOnce, CHECK_INTERVAL);
})();
