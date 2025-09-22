// 필요한 라이브러리들을 불러옵니다.
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const cors = require('cors'); 
require('dotenv').config();

// Express 앱 설정
const app = express();
app.set('trust proxy', 1);
const upload = multer({ dest: '/tmp' });

// CORS 설정
const allowedOrigins = [
    'http://artb.co.kr', 
    'https://artb.co.kr', 
    // 본인의 GitHub Pages 주소를 여기에 추가해주세요 (예: 'https://my-github-id.github.io')
];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS 정책에 의해 허용되지 않는 Origin입니다.'));
    }
  },
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

// 환경 변수 로드 및 검증
const API_KEY = process.env.GOOGLE_API_KEY;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

if (!API_KEY || !EMAIL_USER || !EMAIL_PASS || !RECIPIENT_EMAIL) {
    console.error("!!! 치명적 오류: 필수 환경 변수가 Vercel에 설정되지 않았습니다.");
}

// 서비스 초기화
let genAI, transporter;
try {
    if (!API_KEY) throw new Error("환경 변수 'GOOGLE_API_KEY'가 설정되지 않았습니다.");
    genAI = new GoogleGenerativeAI(API_KEY);

    if (!EMAIL_USER || !EMAIL_PASS) throw new Error("환경 변수 'EMAIL_USER' 또는 'EMAIL_PASS'가 설정되지 않았습니다.");
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS,
        },
    });
} catch (error) {
    console.error("### 치명적 오류: 서비스 초기화 실패! ###", error.message);
}

// 사용량 제한 설정
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 50,
	standardHeaders: true,
	legacyHeaders: false,
    message: "AI 분석 요청 횟수가 너무 많습니다. 15분 후에 다시 시도해주세요.",
});
const formLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
	legacyHeaders: false,
    message: "폼 제출 횟수가 너무 많습니다. 1시간 후에 다시 시도해주세요.",
});

// 라우팅
app.get('/', (req, res) => {
    res.send('Artb Backend Server is running.');
});

// AI 분석 요청 처리 (전문 평가 프롬프트 적용)
app.post('/analyze', apiLimiter, upload.single('image'), async (req, res) => {
    try {
        if (!genAI) throw new Error("Google AI 서비스가 초기화되지 않았습니다.");
        if (!req.file) return res.status(400).json({ error: "이미지 파일이 없습니다." });
        
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `당신은 전문 미술 평가자입니다. 주어진 그림을 '기술적 완성도', '표현력', '창의성', '맥락적 가치', '부가 요소' 순으로 평가하세요. 각 요소를 10점 만점으로 점수화하고, 반드시 구체적인 근거와 함께 설명해야 합니다. 최종적으로 종합 평가 점수와 총평을 제시하세요.
        
        ### 평가 체크리스트:
        1. 기술적 완성도: 구도, 비례, 원근, 묘사력, 재료 활용
        2. 표현력: 색채 감각, 질감, 리듬감, 감정 전달력
        3. 창의성: 주제 해석, 독창성, 상징성
        4. 맥락적 가치: 주제 적합성, 작가 개성
        5. 부가 요소: 완성도, 마감 처리

        ### 출력 형식 (반드시 이 형식을 따르세요):
        [기술적 완성도: 점수/10] - 구체적인 설명.
        [표현력: 점수/10] - 구체적인 설명.
        [창의성: 점수/10] - 구체적인 설명.
        [맥락적 가치: 점수/10] - 구체적인 설명.
        [부가 요소: 점수/10] - 구체적인 설명.
        
        👉 **종합 평가: 총점/10**
        **총평:** (모든 평가를 종합한 최종 코멘트)
        `;
        
        const imagePath = req.file.path;
        const imageBuffer = fs.readFileSync(imagePath);
        const imageBase64 = imageBuffer.toString('base64');
        const imagePart = { inlineData: { data: imageBase64, mimeType: req.file.mimetype } };

        const result = await model.generateContent([prompt, imagePart]);
        const feedbackText = result.response.text();
        
        fs.unlinkSync(imagePath);
        res.json({ feedback: feedbackText });
    } catch (error) {
        console.error("AI 분석 중 오류 발생:", error);
        res.status(500).json({ error: "AI 분석 중 오류가 발생했습니다." });
        if (req.file && req.file.path) fs.unlinkSync(req.file.path);
    }
});

// AI 스타일 분석 요청 처리 (구조화된 피드백 프롬프트 적용)
app.post('/analyze-style', apiLimiter, upload.single('image'), async (req, res) => {
    try {
        if (!genAI) throw new Error("Google AI 서비스가 초기화되지 않았습니다.");
        if (!req.file) return res.status(400).json({ error: "이미지 파일이 없습니다." });
        
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `당신은 Artb의 AI 큐레이터 '아르'입니다. 이 그림의 예술 사조(예: 사실주의, 인상주의, 추상화 등)를 분석하고, 비슷한 화풍을 가진 유명 작가 한두 명을 추천해주세요. 다음 규칙을 반드시 지켜서 답변해주세요:
- **구조:** 답변은 반드시 "### 작품 스타일:", "### 비슷한 작가 추천:", "### 주요 사용 색상:", "### Keywords:"의 네 부분으로 구성합니다. 각 제목 뒤에는 콜론(:)을 붙여주세요.
- **색상 분석:** 그림에서 가장 많이 사용된 3가지 주요 색상의 이름과 HEX 코드를 분석해서 '### 주요 사용 색상:' 항목에 나열해주세요. (예: ### 주요 사용 색상: Sky Blue (#87CEEB), Forest Green (#228B22), Sunset Orange (#FD5E53))
- **줄바꿈:** 각 부분은 두 번의 줄바꿈(\`\\n\\n\`)으로 명확하게 구분합니다.
- **키워드:** 마지막으로, 분석 내용의 핵심을 나타내는 3~5개의 키워드를 '### Keywords:' 항목에 #해시태그 형식으로 요약해주세요. (예: ### Keywords: #인상주의, #빛의 표현, #클로드 모네)`;

        const imagePath = req.file.path;
        const imageBuffer = fs.readFileSync(imagePath);
        const imageBase64 = imageBuffer.toString('base64');
        const imagePart = { inlineData: { data: imageBase64, mimeType: req.file.mimetype } };

        const result = await model.generateContent([prompt, imagePart]);
        const styleFeedback = result.response.text();

        fs.unlinkSync(imagePath);
        res.json({ style_feedback: styleFeedback });
    } catch (error) {
        console.error("AI 스타일 분석 중 오류 발생:", error);
        res.status(500).json({ error: "AI 스타일 분석 중 오류가 발생했습니다." });
        if (req.file && req.file.path) fs.unlinkSync(req.file.path);
    }
});

// 설문조사, 사전등록, 문의하기 라우트는 이전과 동일합니다.
app.post('/survey', formLimiter, (req, res) => {
    const csvFilePath = path.join('/tmp', 'survey_results.csv');
    const { role, interests, feedback_text } = req.body;
    const timestamp = new Date().toISOString();
    const interestsText = Array.isArray(interests) ? interests.join(', ') : '';
    const feedbackTextSanitized = `"${(feedback_text || '').replace(/"/g, '""')}"`;
    const csvRow = `${timestamp},${role},${interestsText},${feedbackTextSanitized}\n`;

    try {
        if (!fs.existsSync(csvFilePath)) {
            fs.writeFileSync(csvFilePath, 'Timestamp,Role,Interests,Feedback\n');
        }
        fs.appendFileSync(csvFilePath, csvRow);
        res.status(200).json({ message: '설문이 성공적으로 제출되었습니다.' });
    } catch (error) {
        console.error('설문 데이터 저장 오류:', error);
        res.status(500).json({ error: '데이터 저장 중 오류가 발생했습니다.' });
    }
});
app.post('/preregister', formLimiter, async (req, res) => {
    try {
        if (!transporter) throw new Error("이메일 서비스가 초기화되지 않았습니다.");
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: '이메일 주소가 필요합니다.' });

        const mailOptions = { from: `"Artb 알림" <${EMAIL_USER}>`, to: RECIPIENT_EMAIL, subject: '🎉 Artb 신규 사전 등록 알림', html: `<h3>새로운 사용자가 사전 등록했습니다!</h3><p><strong>이메일:</strong> ${email}</p>`};
        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: '사전 등록이 완료되었습니다.' });
    } catch (error) {
        console.error('사전 등록 이메일 발송 오류:', error);
        res.status(500).json({ error: '처리 중 오류가 발생했습니다.' });
    }
});
app.post('/contact', formLimiter, async (req, res) => {
    try {
        if (!transporter) throw new Error("이메일 서비스가 초기화되지 않았습니다.");
        const { name, email, message } = req.body;
        if (!name || !email || !message) return res.status(400).json({ error: '모든 필드를 입력해주세요.' });

        const mailOptions = { from: `"Artb 문의" <${EMAIL_USER}>`, to: RECIPIENT_EMAIL, subject: `📢 Artb 새로운 문의 도착: ${name}님`, html: `<h3>새로운 문의가 도착했습니다.</h3><p><strong>보낸 사람:</strong> ${name}</p><p><strong>이메일:</strong> ${email}</p><hr><p><strong>내용:</strong></p><p>${message.replace(/\n/g, '<br>')}</p>`};
        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: '문의가 성공적으로 전달되었습니다.' });
    } catch (error) {
        console.error('문의 이메일 발송 오류:', error);
        res.status(500).json({ error: '처리 중 오류가 발생했습니다.' });
    }
});

// --- 서버 실행 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});

