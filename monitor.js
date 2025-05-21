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
const PRICE_THRESHOLD = 1_000_000; // 이 부분은 그대로 유지됩니다.

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
  await new Promise((r) => setTimeout(r, 500)); // 0.5초 대기
  console.log("✔️ 필터 버튼 클릭 후 대기 완료");
}

// ----------------------------------
// 필터 모달 닫기 (새로 추가)
async function closeFilterModal() {
  // 모달을 닫는 버튼 (예: 'x' 버튼, '닫기' 버튼 또는 모달 외부 클릭)을 찾아 클릭
  // 웹사이트에 모달을 닫는 명확한 버튼이 있는지 확인해야 합니다.
  // 임시로 배경 클릭으로 시도합니다.
  // 만약 모달 내에 '닫기' 버튼이 있다면 해당 셀렉터로 바꿔야 합니다.
  try {
    // 모달 외부 클릭 또는 Esc 키 누르기 시도
    // (가장 일반적인 모달 닫기 방식 중 하나)
    await page.keyboard.press("Escape"); // ESC 키 누르기
    console.log("✔️ 모달 닫기 시도: ESC 키");
    await new Promise((r) => setTimeout(r, 500)); // 0.5초 대기
    // 또는 모달 백드롭 클릭
    // await page.click('.modal-backdrop'); // 모달 백드롭의 정확한 셀렉터를 확인해야 합니다.
    // console.log("✔️ 모달 닫기 시도: 백드롭 클릭");
    // await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    console.warn(
      "⚠️ 모달 닫기 중 오류 또는 모달이 이미 닫혔을 수 있습니다:",
      e.message
    );
  }
}

// ----------------------------------
// 희귀도 버튼 클릭
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
  console.log(`✔️ "${label}" 버튼이 DOM에 나타남`);

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
    // 페이지는 한 번만 로드합니다.
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });
    console.log("✔️ 초기 페이지 로드 완료");

    for (const grade of GRADES) {
      console.log(`▶️ ${grade} 검사 시작`);

      // 1) 필터 모달 열기
      await openFilterModal();

      // 2) 등급 버튼 클릭
      await clickRarityFilter(grade);

      // 필터링 적용 후 페이지가 업데이트될 시간을 줍니다.
      await new Promise((r) => setTimeout(r, 1000)); // 1초 대기

      // 3) 첫 매물이 로드될 때까지 기다리기 (순수 DOM)
      // 주의: 등급 필터 적용 후 페이지 콘텐츠가 완전히 리로드될 수 있으므로,
      // 이 waitForFunction은 새 필터에 맞는 매물이 나타날 때까지 기다려야 합니다.
      await page.waitForFunction(
        () =>
          !!document.querySelector(
            ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span"
          ),
        { timeout: 30000 }
      );
      console.log("✔️ 첫 매물 로드됨");

      // 4) 첫 매물 가격 읽어오기
      const priceText = await page.$eval(
        ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span.text-base.font-bold",
        (el) => el.textContent.replace(/[^0-9]/g, "")
      );
      const price = parseInt(priceText, 10);
      console.log(`🔖 ${grade} 첫 매물 가격: ${price.toLocaleString()} BGSC`);

      // 5) 기준 이하이면 알림
      if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
        const msg = `[알림] ${grade} 등급 첫 매물 ${price.toLocaleString()} BGSC 감지됨`;
        await sendTelegramMessage(msg);
        notified[grade] = price;
      }

      // 등급 선택 후 모달이 자동으로 닫히지 않았다면 닫아줍니다.
      // 보통 등급 버튼 클릭 시 모달이 닫히지만, 그렇지 않은 경우를 대비
      await closeFilterModal();
      console.log("✔️ 모달 닫기 시도 완료 (다음 등급 준비)");

      // 다음 등급을 확인하기 전에, 이전 필터가 완전히 제거되거나 페이지가 안정화될 시간 부여 (필요시)
      // await new Promise(r => setTimeout(r, 1000));
    }
  } catch (e) {
    console.error("❌ 체크 중 오류:", e);
    // 오류 발생 시에도 브라우저가 열려있다면 닫아줍니다.
    if (browser) await browser.close();
    browser = null; // 다음 주기에서 브라우저를 새로 시작하도록 null로 설정
    page = null;
  }
}

// ----------------------------------
// IIFE: 초기 실행 + 주기 실행
(async () => {
  console.log("3. IIFE 시작");
  console.log("🛠️ 모니터링 서비스 시작");
  try {
    // 브라우저와 페이지가 없으면 새로 시작합니다.
    if (!browser || !page) {
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
    }

    await checkOnce();
    console.log("6. 첫 checkOnce 실행 완료");

    setInterval(async () => {
      console.log("⏰ 주기적 체크 시작");
      // 주기적 체크 시에도 브라우저/페이지 상태 확인 후 재시작
      if (!browser || !page || page.isClosed()) {
        // page.isClosed() 추가
        console.log("⚠️ 브라우저/페이지 연결 끊김 감지. 새로 시작합니다.");
        try {
          if (browser) await browser.close(); // 기존 브라우저가 있다면 닫기 시도
        } catch (e) {
          console.warn("⚠️ 기존 브라우저 닫기 중 오류:", e.message);
        }
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
        page = await browser.newPage();
        console.log("✅ 브라우저/페이지 새로 시작 완료");
      }
      await checkOnce();
    }, CHECK_INTERVAL_MS);
  } catch (e) {
    console.error("❌ 초기화 또는 실행 중 치명적인 오류 발생:", e);
    if (browser) await browser.close();
  }
})();
