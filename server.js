const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 데이터베이스 초기화
const db = new sqlite3.Database('./database/artiv.db');

// 업로드 디렉토리 생성
const uploadDir = './uploads';
const correctedDir = './uploads/corrected';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(correctedDir)) fs.mkdirSync(correctedDir, { recursive: true });
if (!fs.existsSync('./database')) fs.mkdirSync('./database', { recursive: true });

// 데이터베이스 테이블 생성
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS artworks (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    original_image_path TEXT,
    corrected_image_path TEXT,
    ai_analysis TEXT,
    expert_feedback TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS feedback_sessions (
    id TEXT PRIMARY KEY,
    artwork_id TEXT,
    ai_score INTEGER,
    ai_feedback TEXT,
    expert_feedback TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (artwork_id) REFERENCES artworks (id)
  )`);

  // 랜딩페이지용 테이블들
  db.run(`CREATE TABLE IF NOT EXISTS survey_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    interests TEXT,
    feedback_text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS contact_inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS preregistrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Multer 설정 (파일 업로드)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('이미지 파일만 업로드 가능합니다.'));
    }
  }
});

// 이미지 왜곡 보정 함수
async function correctImagePerspective(imagePath, outputPath) {
  try {
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    
    // 기본 이미지 최적화
    await image
      .resize(metadata.width, metadata.height, { 
        fit: 'inside',
        withoutEnlargement: true 
      })
      .sharpen()
      .normalize()
      .jpeg({ quality: 90 })
      .toFile(outputPath);
    
    return true;
  } catch (error) {
    console.error('이미지 보정 중 오류:', error);
    return false;
  }
}

// AI 피드백 생성 함수 (OpenAI API 사용)
async function generateAIFeedback(imagePath) {
  try {
    // 실제 구현에서는 OpenAI Vision API를 사용
    // 여기서는 시뮬레이션된 응답을 반환
    const mockAnalysis = {
      composition: {
        score: Math.floor(Math.random() * 30) + 70,
        feedback: "구도가 안정적이며 시선이 자연스럽게 흐릅니다. 3분할 구도를 잘 활용하셨네요."
      },
      shading: {
        score: Math.floor(Math.random() * 30) + 60,
        feedback: "명암 대비가 적절합니다. 주요 개체의 그림자를 조금 더 강조하면 입체감이 살아날 것 같습니다."
      },
      perspective: {
        score: Math.floor(Math.random() * 30) + 65,
        feedback: "투시법이 정확하게 적용되었습니다. 원근감이 잘 표현되어 있습니다."
      },
      color: {
        score: Math.floor(Math.random() * 30) + 70,
        feedback: "색감이 조화롭고 따뜻한 느낌을 줍니다. 색상의 대비를 조금 더 활용해보세요."
      }
    };

    const mockDescription = `전반적으로 안정적인 구도와 따뜻한 색감으로 편안한 분위기를 잘 표현하셨습니다. 
    특히 ${mockAnalysis.composition.feedback} 분석 결과에서 보시는 바와 같이, 
    ${mockAnalysis.shading.feedback} 이렇게 하시면 더욱 완성도 높은 작품이 될 것입니다. 
    계속해서 이런 방향으로 연습하시면 좋겠습니다!`;

    return {
      analysis: mockAnalysis,
      description: mockDescription,
      overallScore: Math.floor((mockAnalysis.composition.score + mockAnalysis.shading.score + 
                               mockAnalysis.perspective.score + mockAnalysis.color.score) / 4)
    };
  } catch (error) {
    console.error('AI 피드백 생성 중 오류:', error);
    return null;
  }
}

// 데모용 시뮬레이션 피드백 생성 함수
function generateMockFeedback() {
  const feedbacks = [
    "전반적으로 안정적인 구도와 따뜻한 색감으로 편안한 분위기를 잘 표현하셨습니다. 특히 3분할 구도를 활용하여 시선이 자연스럽게 흐르고, 명암 대비가 적절하여 입체감이 잘 나타나고 있습니다. 계속해서 이런 방향으로 연습하시면 더욱 완성도 높은 작품을 그리실 수 있을 것입니다!",
    
    "작품에서 느껴지는 감정적 표현이 매우 인상적입니다. 색상의 조화와 붓 터치의 자유로움이 작가의 개성을 잘 드러내고 있네요. 구도 면에서는 중심이 약간 치우쳐 있어서, 다음 작품에서는 균형을 조금 더 고려해보시면 좋겠습니다.",
    
    "기본기가 탄탄하게 갖춰진 작품입니다! 투시법이 정확하게 적용되어 공간감이 잘 표현되었고, 명암 처리도 세심하게 이루어져 있습니다. 색감이 조화롭고 따뜻한 느낌을 주어 보는 이에게 편안함을 전달하고 있습니다.",
    
    "창의적인 아이디어와 독창적인 표현이 돋보이는 작품입니다. 색상의 대비를 잘 활용하여 시각적 임팩트를 주고 있고, 구도도 역동적이면서도 안정감을 유지하고 있습니다. 이런 개성 있는 접근을 계속 유지하시면 좋겠습니다!",
    
    "세부 묘사가 정교하고 꼼꼼하게 이루어진 작품입니다. 특히 질감 표현이 매우 사실적으로 잘 나타나 있어서 작품의 완성도가 높습니다. 전체적인 색감도 조화롭고, 명암의 변화가 자연스러워 입체감이 잘 살아있습니다."
  ];
  
  return feedbacks[Math.floor(Math.random() * feedbacks.length)];
}

// API 라우트들

// 메인 페이지
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 데모용 AI 분석 엔드포인트
app.post('/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
    }

    // 시뮬레이션된 AI 피드백 생성
    const mockFeedback = generateMockFeedback();
    
    res.json({
      success: true,
      feedback: mockFeedback
    });

  } catch (error) {
    console.error('분석 처리 중 오류:', error);
    res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
  }
});

// 설문조사 제출 엔드포인트
app.post('/survey', async (req, res) => {
  try {
    const { role, interests, feedback_text } = req.body;
    
    // 데이터베이스에 설문 결과 저장
    const stmt = db.prepare(`
      INSERT INTO survey_responses (role, interests, feedback_text, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(role, JSON.stringify(interests), feedback_text);
    stmt.finalize();

    res.json({ success: true, message: '설문이 성공적으로 제출되었습니다.' });

  } catch (error) {
    console.error('설문 제출 중 오류:', error);
    res.status(500).json({ error: '설문 제출 중 오류가 발생했습니다.' });
  }
});

// 문의하기 제출 엔드포인트
app.post('/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    
    // 데이터베이스에 문의 저장
    const stmt = db.prepare(`
      INSERT INTO contact_inquiries (name, email, message, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(name, email, message);
    stmt.finalize();

    res.json({ success: true, message: '문의가 성공적으로 전달되었습니다.' });

  } catch (error) {
    console.error('문의 제출 중 오류:', error);
    res.status(500).json({ error: '문의 제출 중 오류가 발생했습니다.' });
  }
});

// 사전 등록 엔드포인트
app.post('/preregister', async (req, res) => {
  try {
    const { email } = req.body;
    
    // 데이터베이스에 사전 등록 저장
    const stmt = db.prepare(`
      INSERT INTO preregistrations (email, created_at)
      VALUES (?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(email);
    stmt.finalize();

    res.json({ success: true, message: '사전 등록이 완료되었습니다.' });

  } catch (error) {
    console.error('사전 등록 중 오류:', error);
    res.status(500).json({ error: '사전 등록 중 오류가 발생했습니다.' });
  }
});

// 작품 업로드 및 분석
app.post('/api/upload', upload.single('artwork'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
    }

    const artworkId = uuidv4();
    const correctedImagePath = path.join(correctedDir, `corrected-${artworkId}.jpg`);
    
    // 이미지 왜곡 보정
    const correctionSuccess = await correctImagePerspective(req.file.path, correctedImagePath);
    
    if (!correctionSuccess) {
      return res.status(500).json({ error: '이미지 보정에 실패했습니다.' });
    }

    // AI 피드백 생성
    const aiFeedback = await generateAIFeedback(correctedImagePath);
    
    if (!aiFeedback) {
      return res.status(500).json({ error: 'AI 피드백 생성에 실패했습니다.' });
    }

    // 데이터베이스에 저장
    const stmt = db.prepare(`
      INSERT INTO artworks (id, original_image_path, corrected_image_path, ai_analysis, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(artworkId, req.file.path, correctedImagePath, JSON.stringify(aiFeedback));
    stmt.finalize();

    // 피드백 세션 저장
    const feedbackStmt = db.prepare(`
      INSERT INTO feedback_sessions (id, artwork_id, ai_score, ai_feedback, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    feedbackStmt.run(uuidv4(), artworkId, aiFeedback.overallScore, aiFeedback.description);
    feedbackStmt.finalize();

    res.json({
      success: true,
      artworkId: artworkId,
      feedback: aiFeedback,
      correctedImageUrl: `/uploads/corrected/corrected-${artworkId}.jpg`
    });

  } catch (error) {
    console.error('업로드 처리 중 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 작품 목록 조회
app.get('/api/artworks', (req, res) => {
  db.all(`
    SELECT a.*, fs.ai_score, fs.ai_feedback 
    FROM artworks a 
    LEFT JOIN feedback_sessions fs ON a.id = fs.artwork_id 
    ORDER BY a.created_at DESC
  `, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: '데이터 조회 중 오류가 발생했습니다.' });
    }
    res.json(rows);
  });
});

// 특정 작품 조회
app.get('/api/artworks/:id', (req, res) => {
  const artworkId = req.params.id;
  
  db.get(`
    SELECT a.*, fs.ai_score, fs.ai_feedback 
    FROM artworks a 
    LEFT JOIN feedback_sessions fs ON a.id = fs.artwork_id 
    WHERE a.id = ?
  `, [artworkId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: '데이터 조회 중 오류가 발생했습니다.' });
    }
    if (!row) {
      return res.status(404).json({ error: '작품을 찾을 수 없습니다.' });
    }
    res.json(row);
  });
});

// 정적 파일 서빙 (보정된 이미지)
app.use('/uploads', express.static('uploads'));

// 에러 핸들링 미들웨어
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '파일 크기가 너무 큽니다.' });
    }
  }
  res.status(500).json({ error: error.message });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`🎨 아트비(Artiv) AI 미술 교육 플랫폼이 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`📱 브라우저에서 http://localhost:${PORT} 를 열어보세요.`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 서버를 종료합니다...');
  db.close((err) => {
    if (err) {
      console.error('데이터베이스 종료 중 오류:', err);
    } else {
      console.log('✅ 데이터베이스 연결이 종료되었습니다.');
    }
    process.exit(0);
  });
});
