// 필요한 라이브러리들을 불러옵니다.
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const cors = require('cors'); // CORS 미들웨어 추가
require('dotenv').config(); // .env 파일 사용을 위한 라이브러리

// --- 환경 변수 로드 및 검증 (가장 먼저 실행) ---
const API_KEY = process.env.GOOGLE_API_KEY;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

// 서버 시작 전 필수 환경 변수가 모두 있는지 확인
if (!API_KEY || !EMAIL_USER || !EMAIL_PASS || !RECIPIENT_EMAIL) {
    console.error("!!! 치명적 오류: 필수 환경 변수가 Vercel에 설정되지 않았습니다.");
    console.error("GOOGLE_API_KEY, EMAIL_USER, EMAIL_PASS, RECIPIENT_EMAIL 변수를 모두 확인해주세요.");
    // 실제 운영에서는 여기서 프로세스를 종료할 수 있습니다.
    // process.exit(1); 
}

// Express 앱과 Multer (파일 업로드 처리용)를 설정합니다.
const app = express();
const upload = multer({ dest: '/tmp' }); // Vercel의 쓰기 가능한 임시 폴더

// --- 미들웨어 설정 ---
// CORS 설정: GitHub Pages 및 개인 도메인에서의 요청을 허용합니다.
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

// --- 서비스 초기화 ---
const genAI = new GoogleGenerativeAI(API_KEY);
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
    },
});

// --- 사용량 제한 (Rate Limiter) 설정 ---
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

// --- 라우팅 (Routing) ---
app.get('/', (req, res) => {
    res.send('Artb Backend Server is running.');
});

// AI 분석 요청 처리
app.post('/analyze', apiLimiter, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "이미지 파일이 없습니다." });
        const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
        const prompt = "당신은 친절하고 전문적인 미술 선생님입니다. 이 그림을 보고, 학생의 실력 향상에 도움이 될 만한 긍정적인 피드백과 구체적인 개선점을 설명해주세요. 구도, 명암, 형태, 창의성 등을 종합적으로 고려해서요.";
        
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

// AI 스타일 분석 요청 처리
app.post('/analyze-style', apiLimiter, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "이미지 파일이 없습니다." });
        const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
        const prompt = "You are an expert art historian. Analyze this image and describe its artistic style (e.g., realism, impressionism, abstract, cartoon, etc.). Also, suggest one or two famous artists with a similar style that the creator might find inspiring. Respond in a concise and encouraging tone, in Korean.";

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

// 설문조사 데이터 저장
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

// 사전 등록 이메일 발송
app.post('/preregister', formLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: '이메일 주소가 필요합니다.' });
    if (!EMAIL_USER || !RECIPIENT_EMAIL) return res.status(500).json({ error: '서버 이메일 설정이 필요합니다.' });

    const mailOptions = { from: `"Artb 알림" <${EMAIL_USER}>`, to: RECIPIENT_EMAIL, subject: '🎉 Artb 신규 사전 등록 알림', html: `<h3>새로운 사용자가 사전 등록했습니다!</h3><p><strong>이메일:</strong> ${email}</p>`};
    try {
        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: '사전 등록이 완료되었습니다.' });
    } catch (error) {
        console.error('사전 등록 이메일 발송 오류:', error);
        res.status(500).json({ error: '처리 중 오류가 발생했습니다.' });
    }
});

// 문의하기 이메일 발송
app.post('/contact', formLimiter, async (req, res) => {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    if (!EMAIL_USER || !RECIPIENT_EMAIL) return res.status(500).json({ error: '서버 이메일 설정이 필요합니다.' });

    const mailOptions = { from: `"Artb 문의" <${EMAIL_USER}>`, to: RECIPIENT_EMAIL, subject: `📢 Artb 새로운 문의 도착: ${name}님`, html: `<h3>새로운 문의가 도착했습니다.</h3><p><strong>보낸 사람:</strong> ${name}</p><p><strong>이메일:</strong> ${email}</p><hr><p><strong>내용:</strong></p><p>${message.replace(/\n/g, '<br>')}</p>`};
    try {
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

