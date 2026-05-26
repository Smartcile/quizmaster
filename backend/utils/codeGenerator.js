const crypto = require('crypto');

function generateQuizCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateTeamId() {
  return crypto.randomUUID();
}

module.exports = { generateQuizCode, generateTeamId };
