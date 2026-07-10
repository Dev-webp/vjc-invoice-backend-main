const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const pdfService = {
  generatePdfFromHtml: async (html) => {
    try {
      console.log("========== PDF DEBUG START ==========");
      console.log("Node Version:", process.version);

      const executablePath = await chromium.executablePath();

      console.log("Executable Path:", executablePath);
      console.log("Chromium Args:", chromium.args);

      const browser = await puppeteer.launch({
        args: chromium.args,
        executablePath,
        headless: true,
      });

      console.log("Browser launched successfully");

      try {
        const page = await browser.newPage();
        console.log("New page created");

        await page.setContent(html, {
          waitUntil: "networkidle0",
        });

        console.log("HTML loaded");

        const pdfBuffer = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: {
            top: "10px",
            bottom: "10px",
            left: "10px",
            right: "10px",
          },
        });

        console.log("PDF generated successfully");
        console.log("========== PDF DEBUG END ==========");

        return pdfBuffer;
      } finally {
        await browser.close();
        console.log("Browser closed");
      }
    } catch (error) {
      console.error("========== PDF ERROR ==========");
      console.error(error);
      console.error(error.stack);
      console.error("========== PDF ERROR END ==========");

      throw error;
    }
  },
};

module.exports = pdfService;