'use strict';

const SECRET_ENV_NAME = /(?:API_KEY|ACCESS_KEY|SECRET|TOKEN|JWT|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|AUTH)/i;
const SECRET_FILE_NAME = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|credentials?(?:\..*)?|secrets?(?:\..*)?|service-account[^/\\]*\.json|[^/\\]*(?:credential|secret)[^/\\]*\.(?:json|ya?ml|txt|env)|[^/\\]+\.(?:pem|p12|pfx|key|token|secret))$/i;

function sanitizeChildEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => !SECRET_ENV_NAME.test(name)));
}

function isSensitivePath(value) {
  return String(value).split(/[\\/]/).some(part => SECRET_FILE_NAME.test(part));
}

module.exports = { SECRET_ENV_NAME, SECRET_FILE_NAME, isSensitivePath, sanitizeChildEnvironment };
