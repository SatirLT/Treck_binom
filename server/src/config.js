const path = require('path');

// Load .env file if it exists
try {
  const fs = require('fs');
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=');
        if (key && value !== undefined) {
          process.env[key.trim()] = value.trim();
        }
      }
    });
  }
} catch (e) {
  // .env is optional
}

module.exports = {
  // Binom tracker settings
  binom: {
    url: process.env.BINOM_URL || 'https://your-binom-domain.com',
    apiKey: process.env.BINOM_API_KEY || '',
    campaignId: process.env.CAMPAIGN_ID || '1',
    landingId: process.env.LANDING_ID || '1',
  },

  // Server settings
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  },

  // Database path
  dbPath: path.join(__dirname, '..', 'data', 'clicks.db'),
};
