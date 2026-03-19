const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer.
  // This physically forces the Chrome browser to be downloaded INSIDE 
  // the project workspace so that Render.com does not delete it when starting the server.
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
