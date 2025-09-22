// 필요한 라이브러리들을 불러옵니다.
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
require('dotenv').config(); // .env 파일 사용을 위한 라이브러리

// Express 앱과 Multer (파일 업로드 처리용)를 설정합니다.
const app = express();

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({ dest: UPLOAD_DIR });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 환경 변수 설정 ---
const API_KEY = process.env.GOOGLE_API_KEY;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

let genAI = null;
if (!API_KEY) {
    console.error("경고: GOOGLE_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.");
} else {
    genAI = new GoogleGenerativeAI(API_KEY);
}

// --- Nodemailer 설정 ---
const transporter = EMAIL_USER && EMAIL_PASS
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS,
        },
    })
    : null;

if (!EMAIL_USER || !EMAIL_PASS) {
    console.warn('경고: 이메일 전송을 위한 EMAIL_USER 또는 EMAIL_PASS가 설정되지 않았습니다.');
}

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

const chatLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 30, // 10분 동안 30번
    standardHeaders: true,
    legacyHeaders: false,
    message: "채팅 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
});

const removeFileSafely = async (filePath) => {
    if (!filePath) {
        return;
    }
    try {
        await fsPromises.unlink(filePath);
    } catch (error) {
        console.warn('임시 파일 삭제 중 오류가 발생했습니다:', error);
    }
};

const sanitizeCsvValue = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

// --- 라우팅 (Routing) ---
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// AI 분석 요청 처리
app.post('/analyze', apiLimiter, upload.single('image'), async (req, res) => {
    const imagePath = req.file?.path;

    if (!genAI) {
        await removeFileSafely(imagePath);
        return res.status(500).json({ error: "AI 서비스 설정이 필요합니다." });
    }

    if (!imagePath) {
        return res.status(400).json({ error: "이미지 파일이 없습니다." });
    }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
        const prompt = "당신은 친절하고 전문적인 미술 선생님입니다. 이 그림을 보고, 학생의 실력 향상에 도움이 될 만한 긍정적인 피드백과 구체적인 개선점을 설명해주세요. 구도, 명암, 형태, 창의성 등을 종합적으로 고려해서요.";

        const imageBuffer = await fsPromises.readFile(imagePath);
        const imageBase64 = imageBuffer.toString('base64');
        const imagePart = { inlineData: { data: imageBase64, mimeType: req.file.mimetype } };

        const result = await model.generateContent([prompt, imagePart]);
        const feedbackText = result.response.text();

        res.json({ feedback: feedbackText });
    } catch (error) {
        console.error("AI 분석 중 오류 발생:", error);
        res.status(500).json({ error: "AI 분석 중 오류가 발생했습니다." });
    } finally {
        await removeFileSafely(imagePath);
    }
});

// ✨ AI 스타일 분석 요청 처리
app.post('/analyze-style', apiLimiter, upload.single('image'), async (req, res) => {
    const imagePath = req.file?.path;

    if (!genAI) {
        await removeFileSafely(imagePath);
        return res.status(500).json({ error: "AI 서비스 설정이 필요합니다." });
    }

    if (!imagePath) {
        return res.status(400).json({ error: "이미지 파일이 없습니다." });
    }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
        const prompt = "You are an expert art historian. Analyze this image and describe its artistic style (e.g., realism, impressionism, abstract, cartoon, etc.). Also, suggest one or two famous artists with a similar style that the creator might find inspiring. Respond in a concise and encouraging tone, in Korean.";

        const imageBuffer = await fsPromises.readFile(imagePath);
        const imageBase64 = imageBuffer.toString('base64');
        const imagePart = { inlineData: { data: imageBase64, mimeType: req.file.mimetype } };

        const result = await model.generateContent([prompt, imagePart]);
        const styleFeedback = result.response.text();

        res.json({ style_feedback: styleFeedback });
    } catch (error) {
        console.error("AI 스타일 분석 중 오류 발생:", error);
        res.status(500).json({ error: "AI 스타일 분석 중 오류가 발생했습니다." });
    } finally {
        await removeFileSafely(imagePath);
    }
});

// ✨ AI 챗봇 요청 처리
app.post('/chat', chatLimiter, async (req, res) => {
    if (!genAI) {
        return res.status(500).json({ error: "AI 서비스 설정이 필요합니다." });
    }

    try {
        const { message, history } = req.body;
        const userMessage = typeof message === 'string' ? message.trim() : '';

        if (!userMessage) {
            return res.status(400).json({ error: "메시지가 없습니다." });
        }

        const sanitizedHistory = Array.isArray(history) ? history : [];

        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const chat = model.startChat({
            history: sanitizedHistory,
            generationConfig: {
                maxOutputTokens: 200,
            },
        });

        const systemPrompt = "당신은 Artb의 친절하고 유용한 AI 챗봇 '아르'입니다. 당신의 역할은 사용자들에게 미술에 대한 영감을 주고, Artb 서비스에 대해 안내하는 것입니다. 항상 밝고 긍정적인 톤으로 한국어로 대답해주세요.";
        const fullPrompt = `${systemPrompt}\n\n사용자 질문: ${userMessage}`;

        const result = await chat.sendMessage(fullPrompt);
        const reply = result.response.text();

        res.json({ reply });
    } catch (error) {
        console.error("AI 챗봇 처리 중 오류 발생:", error);
        res.status(500).json({ error: "AI 챗봇 처리 중 오류가 발생했습니다." });
    }
});


// 설문조사 데이터 저장
app.post('/survey', formLimiter, (req, res) => {
    const csvFilePath = path.join(__dirname, 'survey_results.csv');
    const { role, interests, feedback_text: feedbackText } = req.body;
    const timestamp = new Date().toISOString();

    const roleValue = typeof role === 'string' ? role.trim() : '';
    const interestsList = Array.isArray(interests)
        ? interests
        : interests
            ? [interests]
            : [];
    const interestsText = interestsList.map((item) => String(item).trim()).join('; ');
    const feedbackValue = typeof feedbackText === 'string' ? feedbackText.trim() : '';

    const csvRow = `${timestamp},${sanitizeCsvValue(roleValue)},${sanitizeCsvValue(interestsText)},${sanitizeCsvValue(feedbackValue)}\n`;

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
    const trimmedEmail = typeof email === 'string' ? email.trim() : '';

    if (!trimmedEmail) {
        return res.status(400).json({ error: '이메일 주소가 필요합니다.' });
    }

    if (!transporter || !RECIPIENT_EMAIL) {
        return res.status(500).json({ error: '서버 이메일 설정이 필요합니다.' });
    }

    const mailOptions = {
        from: `"Artb 알림" <${EMAIL_USER}>`,
        to: RECIPIENT_EMAIL,
        replyTo: trimmedEmail,
        subject: '🎉 Artb 신규 사전 등록 알림',
        html: `<h3>새로운 사용자가 사전 등록했습니다!</h3><p><strong>이메일:</strong> ${trimmedEmail}</p>`,
    };

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
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedEmail = typeof email === 'string' ? email.trim() : '';
    const messageValue = typeof message === 'string' ? message.trim() : '';

    if (!trimmedName || !trimmedEmail || !messageValue) {
        return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }

    if (!transporter || !RECIPIENT_EMAIL) {
        return res.status(500).json({ error: '서버 이메일 설정이 필요합니다.' });
    }

    const safeName = escapeHtml(trimmedName);
    const safeEmail = escapeHtml(trimmedEmail);
    const safeMessage = escapeHtml(messageValue).replace(/\n/g, '<br>');

    const mailOptions = {
        from: `"Artb 문의" <${EMAIL_USER}>`,
        to: RECIPIENT_EMAIL,
        replyTo: trimmedEmail,
        subject: `📢 Artb 새로운 문의 도착: ${safeName}님`,
        html: `<h3>새로운 문의가 도착했습니다.</h3><p><strong>보낸 사람:</strong> ${safeName}</p><p><strong>이메일:</strong> ${safeEmail}</p><hr><p><strong>내용:</strong></p><p>${safeMessage}</p>`,
    };

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
