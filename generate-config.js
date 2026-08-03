// Vercel 빌드 단계에서 환경변수를 읽어 브라우저용 env-config.js를 생성한다.
// 번들러가 없는 정적 사이트라 빌드타임 주입을 못 하므로, 배포 시 이 스크립트가
// window.ENV를 심는 env-config.js를 만들어 준다. (anon key는 공개 키라 클라이언트 노출 OK)
const fs = require("fs");

const url = process.env.VITE_SUPABASE_URL || "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
const missing = [];

if (!url) missing.push("VITE_SUPABASE_URL");
if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");

// 환경변수가 비어 있으면 배포된 사이트가 조용히 깨지는 대신, 빌드 단계에서 바로 실패시킨다.
if (missing.length > 0) {
  console.error(`누락된 환경변수: ${missing.join(", ")}`);
  process.exit(1);
}

const contents = `// 이 파일은 빌드(generate-config.js)로 자동 생성됩니다. 직접 수정하지 마세요.
window.ENV = {
  VITE_SUPABASE_URL: ${JSON.stringify(url)},
  VITE_SUPABASE_ANON_KEY: ${JSON.stringify(anonKey)}
};
`;

fs.writeFileSync("env-config.js", contents);
console.log("env-config.js 생성 완료");
