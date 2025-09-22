// 필요한 라이브러리들을 불러옵니다.
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
require('dotenv').config(); // .env 파일 사용을 위한 라이브러리

// Express 앱과 Multer (파일 업로드 처리용)를 설정합니다.
const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

// --- 환경 변수 설정 ---
const API_KEY = process.env.GOOGLE_API_KEY;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

if (!API_KEY) {
    console.error("경고: GOOGLE_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.");
}

const genAI = new GoogleGenerativeAI(API_KEY);

async function isArtworkImage(model, imagePart) {
    const verificationPrompt = "이 이미지가 손으로 그린 그림인지 Y/N으로만 답하라.";
    const maxAttempts = 2;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const result = await model.generateContent([verificationPrompt, imagePart]);
            const response = await result.response;
            const normalizedAnswer = (response.text() || '').trim().toLowerCase();

            if (normalizedAnswer.startsWith('y')) {
                return true;
            }

            if (normalizedAnswer.startsWith('n')) {
                return false;
            }

            lastError = new Error(`Unexpected verification response: ${normalizedAnswer}`);
        } catch (error) {
            lastError = error;
        }

        if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }

    if (lastError) {
        throw lastError;
    }

    throw new Error('Unable to determine whether the image is artwork.');
}

async function handleVisionAnalysis(req, res, { prompt, responseKey, errorLogLabel, errorResponseMessage }) {
    if (!req.file) {
        return res.status(400).json({ error: "이미지 파일이 없습니다." });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
    const imagePath = req.file.path;

    try {
        const imageBuffer = fs.readFileSync(imagePath);
        const imageBase64 = imageBuffer.toString('base64');
        const imagePart = { inlineData: { data: imageBase64, mimeType: req.file.mimetype } };

        const isArtwork = await isArtworkImage(model, imagePart);
        if (!isArtwork) {
            return res.status(422).json({ error: '그림이 아닌 이미지로는 분석을 진행할 수 없습니다.' });
        }

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        return res.json({ [responseKey]: text });
    } catch (error) {
        console.error(`${errorLogLabel}:`, error);
        return res.status(500).json({ error: errorResponseMessage });
    } finally {
        if (req.file && req.file.path) {
            try {
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
            } catch (unlinkError) {
                console.error('업로드 파일 삭제 중 오류:', unlinkError);
            }
        }
    }
}

// --- Nodemailer 설정 ---
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

const chatLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 30, // 10분 동안 30번
    standardHeaders: true,
        legacyHeaders: false,
    message: "채팅 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
});


// --- 라우팅 (Routing) ---
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// AI 분석 요청 처리
app.post('/analyze', apiLimiter, upload.single('image'), async (req, res) => {
    const prompt = "당신은 친절하고 전문적인 미술 선생님입니다. 이 그림을 보고, 학생의 실력 향상에 도움이 될 만한 긍정적인 피드백과 구체적인 개선점을 설명해주세요. 구도, 명암, 형태, 창의성 등을 종합적으로 고려해서요.";

    return handleVisionAnalysis(req, res, {
        prompt,
        responseKey: 'feedback',
        errorLogLabel: 'AI 분석 중 오류 발생',
        errorResponseMessage: 'AI 분석 중 오류가 발생했습니다.',
    });
});

// ✨ AI 스타일 분석 요청 처리
app.post('/analyze-style', apiLimiter, upload.single('image'), async (req, res) => {
    const prompt = "You are an expert art historian. Analyze this image and describe its artistic style (e.g., realism, impressionism, abstract, cartoon, etc.). Also, suggest one or two famous artists with a similar style that the creator might find inspiring. Respond in a concise and encouraging tone, in Korean.";

    return handleVisionAnalysis(req, res, {
        prompt,
        responseKey: 'style_feedback',
        errorLogLabel: 'AI 스타일 분석 중 오류 발생',
        errorResponseMessage: 'AI 스타일 분석 중 오류가 발생했습니다.',
    });
});

// ✨ AI 챗봇 요청 처리
app.post('/chat', chatLimiter, async (req, res) => {
    try {
        const { message, history } = req.body;
        if (!message) return res.status(400).json({ error: "메시지가 없습니다." });

        const model = genAI.getGenerativeModel({ model: "gemini-pro"});
        const chat = model.startChat({
            history: history || [],
            generationConfig: {
                maxOutputTokens: 200,
            },
        });

        const system_prompt = "당신은 Artb의 친절하고 유용한 AI 챗봇 '아르'입니다. 당신의 역할은 사용자들에게 미술에 대한 영감을 주고, Artb 서비스에 대해 안내하는 것입니다. 항상 밝고 긍정적인 톤으로 한국어로 대답해주세요.";
        const full_prompt = system_prompt + "\n\n사용자 질문: " + message;

        const result = await chat.sendMessage(full_prompt);
        const response = await result.response;
        const reply = response.text();

        res.json({ reply: reply });
    } catch (error) {
        console.error("AI 챗봇 처리 중 오류 발생:", error);
        res.status(500).json({ error: "AI 챗봇 처리 중 오류가 발생했습니다." });
    }
});


// 설문조사 데이터 저장
app.post('/survey', formLimiter, (req, res) => {
    const csvFilePath = path.join(__dirname, 'survey_results.csv');
    const { role, interests, feedback_text } = req.body;
    const timestamp = new Date().toISOString();
    const interestsText = interests.join(', ');
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

    const mailOptions = {
        from: `"Artb 알림" <${EMAIL_USER}>`,
        to: RECIPIENT_EMAIL,
        subject: '🎉 Artb 신규 사전 등록 알림',
        html: `<h3>새로운 사용자가 사전 등록했습니다!</h3><p><strong>이메일:</strong> ${email}</p>`,
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
    if (!name || !email || !message) return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    if (!EMAIL_USER || !RECIPIENT_EMAIL) return res.status(500).json({ error: '서버 이메일 설정이 필요합니다.' });

    const mailOptions = {
        from: `"Artb 문의" <${EMAIL_USER}>`,
        to: RECIPIENT_EMAIL,
        subject: `📢 Artb 새로운 문의 도착: ${name}님`,
        html: `<h3>새로운 문의가 도착했습니다.</h3><p><strong>보낸 사람:</strong> ${name}</p><p><strong>이메일:</strong> ${email}</p><hr><p><strong>내용:</strong></p><p>${message.replace(/\n/g, '<br>')}</p>`,
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
