console.log("✅ monitor.js 시작됨");
let count = 0;
require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = 5000;
const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 1000000;

let browser, page;

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

async function openFilterModal() {
  await page.click("button.metallic-button");
  await new Promise((r) => setTimeout(r, 500));
}

// async function closeFilterModal() {
//   try {
//     await page.keyboard.press("Escape");
//     await new Promise((r) => setTimeout(r, 500));
//   } catch (e) {
//     console.warn("모달 닫기 중 오류:", e.message);
//   }
// }

async function clickRarityFilter(label) {
  await page.waitForFunction(
    (lbl) => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.some(
        (b) => b.textContent.trim() === lbl && b.offsetParent !== null
      );
    },
    { timeout: 10000 },
    label
  );

  await page.evaluate((lbl) => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === lbl
    );
    btn?.click();
  }, label);
}
let firstRun = true;
async function checkOnce() {
  console.log("🚀 checkOnce 시작");

  try {
    try {
      await page.goto(TARGET_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      if (firstRun) {
        // 첫 로드 때만 30초 대기
        await new Promise((r) => setTimeout(r, 30000));
        firstRun = false;
        console.log("✔️ 첫 로딩 30초 대기 완료");
      }

      // 1. 가격 요소가 로드될 때까지 대기
      await page.waitForSelector(".enhanced-nft-price .text-base.font-bold", {
        timeout: 15000,
      });

      console.log("✔️ 페이지 로딩 및 필터 버튼 확인 완료");
    } catch (navErr) {
      console.error("❌ 페이지 이동 또는 버튼 대기 실패1:", navErr.message);
      return;
    }
    await openFilterModal();
    for (const grade of GRADES) {
      count++;

      console.log(`▶️ ${grade} 검사 시작, count:`,count);

      await clickRarityFilter(grade);
      await new Promise((r) => setTimeout(r, 1000));

      await page.waitForFunction(
        () =>
          !!document.querySelector(
            ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span"
          ),
        { timeout: 30000 }
      );

      // 2. 가격 문자열 추출 & 숫자만 남기기
      const firstPriceText = await page.$eval(
        ".enhanced-nft-price .text-base.font-bold",
        (el) => el.textContent.replace(/[^0-9]/g, "")
      );
      const price = parseInt(firstPriceText, 10);
      console.log("첫 번째 매물 가격:", price); // 예: 1195000

      if (price > 0 && price <= PRICE_THRESHOLD) {
        const msg = `[알림] ${grade} 등급 첫 매물 ${price.toLocaleString()} BGSC 감지됨`;
        console.log(msg);
        await sendTelegramMessage(msg);
      }
    }
  } catch (e) {
    console.error("❌ 체크 중 오류:", e.message);
    try {
      if (browser?.isConnected() && !page.isClosed()) {
        await page.close();
      }
    } catch (closeErr) {
      console.warn("⚠️ page.close 실패:", closeErr.message);
    }
    //browser = null;
    //page = null;
  }
}

(async () => { try {
  browser = await puppeteer.launch({
    headless: true, // 클라우드에서는 headless 모드로 실행
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
    // executablePath 제거 → Puppeteer가 번들로 제공하는 Chromium 사용
  });

  while (true) {
    page = await browser.newPage();

    // 봇 차단 회피용 user-agent 설정
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36"
    );

    try {
      await checkOnce();
    } catch (e) {
      console.error("❌ checkOnce 내부 에러:", e.message);
    } finally {
      if (page && !page.isClosed()) {
        try {
          await page.close();
        } catch (closeErr) {
          console.warn("⚠️ page.close 실패:", closeErr.message);
        }
      }
    }

    await new Promise((res) => setTimeout(res, CHECK_INTERVAL_MS));
  }
} catch (err) {
  console.error("❌ monitor.js 실행 중 에러:", err);
}
})();
