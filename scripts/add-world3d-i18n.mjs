/**
 * One-off: adds the world3d hero keys (headline split, CTA, chips, features)
 * to every locale's home section. The headline lines are derived from each
 * locale's existing home.slogan so the two-line layout reads naturally.
 *
 * Usage: node scripts/add-world3d-i18n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'lib', 'i18n', 'locales');

/** locale → the new home.* values */
const KEYS = {
  'ar-SA': {
    sloganLine1: 'اصنع درسًا تفاعليًا يشدّ',
    sloganLine2: 'طلابك من',
    sloganHighlight: 'أول دقيقة',
    cta: 'إنشاء درس من المنهج',
    chipControls: 'الضوابط',
    chipLessonHelp: 'مساعدة الدرس',
    chipUploadClass: 'رفع الفصل',
    featureInteractive: 'محتوى تفاعلي',
    featureCustom: 'دروس مخصصة',
    featureAI: 'ذكاء اصطناعي متقدم',
    featureFun: 'تجربة تعليمية ممتعة',
  },
  'de-DE': {
    sloganLine1: 'Baue eine Stunde, die deine Schüler',
    sloganLine2: 'ab der',
    sloganHighlight: 'ersten Minute mitreißt',
    cta: 'Lektion aus dem Lehrplan erstellen',
    chipControls: 'Einstellungen',
    chipLessonHelp: 'Lektionshilfe',
    chipUploadClass: 'Kapitel hochladen',
    featureInteractive: 'Interaktive Inhalte',
    featureCustom: 'Maßgeschneiderte Lektionen',
    featureAI: 'Fortgeschrittene KI',
    featureFun: 'Lernen mit Freude',
  },
  'en-US': {
    sloganLine1: 'Build a lesson that hooks',
    sloganLine2: 'your students from',
    sloganHighlight: 'minute one',
    cta: 'Create a lesson from the curriculum',
    chipControls: 'Controls',
    chipLessonHelp: 'Lesson assist',
    chipUploadClass: 'Upload chapter',
    featureInteractive: 'Interactive content',
    featureCustom: 'Tailored lessons',
    featureAI: 'Advanced AI',
    featureFun: 'A joyful learning experience',
  },
  'es-MX': {
    sloganLine1: 'Crea una lección que enganche',
    sloganLine2: 'a tus alumnos desde el',
    sloganHighlight: 'primer minuto',
    cta: 'Crear lección del currículo',
    chipControls: 'Controles',
    chipLessonHelp: 'Ayuda de lección',
    chipUploadClass: 'Subir capítulo',
    featureInteractive: 'Contenido interactivo',
    featureCustom: 'Lecciones a medida',
    featureAI: 'IA avanzada',
    featureFun: 'Aprender es divertido',
  },
  'fr-FR': {
    sloganLine1: 'Créez une leçon qui captive',
    sloganLine2: 'vos élèves dès la',
    sloganHighlight: 'première minute',
    cta: 'Créer une leçon du programme',
    chipControls: 'Réglages',
    chipLessonHelp: 'Aide à la leçon',
    chipUploadClass: 'Importer un chapitre',
    featureInteractive: 'Contenu interactif',
    featureCustom: 'Leçons sur mesure',
    featureAI: 'IA avancée',
    featureFun: 'Apprendre en s’amusant',
  },
  'ja-JP': {
    sloganLine1: '最初の1分から生徒を引き込む',
    sloganLine2: 'レッスンを',
    sloganHighlight: '作ろう',
    cta: 'カリキュラムからレッスンを作成',
    chipControls: '調整',
    chipLessonHelp: 'レッスン支援',
    chipUploadClass: '章をアップロード',
    featureInteractive: 'インタラクティブな内容',
    featureCustom: 'オーダーメイドの授業',
    featureAI: '高度なAI',
    featureFun: '楽しい学習体験',
  },
  'ko-KR': {
    sloganLine1: '첫 1분부터 학생을 사로잡는',
    sloganLine2: '수업을',
    sloganHighlight: '만들어 보세요',
    cta: '커리큘럼으로 수업 만들기',
    chipControls: '설정',
    chipLessonHelp: '수업 도움',
    chipUploadClass: '단원 업로드',
    featureInteractive: '인터랙티브 콘텐츠',
    featureCustom: '맞춤형 수업',
    featureAI: '고급 AI',
    featureFun: '즐거운 학습 경험',
  },
  'pt-BR': {
    sloganLine1: 'Crie uma aula que prenda',
    sloganLine2: 'os alunos desde o',
    sloganHighlight: 'primeiro minuto',
    cta: 'Criar aula do currículo',
    chipControls: 'Ajustes',
    chipLessonHelp: 'Ajuda da aula',
    chipUploadClass: 'Enviar capítulo',
    featureInteractive: 'Conteúdo interativo',
    featureCustom: 'Aulas sob medida',
    featureAI: 'IA avançada',
    featureFun: 'Aprender é divertido',
  },
  'ru-RU': {
    sloganLine1: 'Создайте урок, который увлечёт',
    sloganLine2: 'учеников с',
    sloganHighlight: 'первой минуты',
    cta: 'Создать урок из программы',
    chipControls: 'Настройки',
    chipLessonHelp: 'Помощь с уроком',
    chipUploadClass: 'Загрузить главу',
    featureInteractive: 'Интерактивный контент',
    featureCustom: 'Уроки под запрос',
    featureAI: 'Продвинутый ИИ',
    featureFun: 'Обучение в удовольствие',
  },
  'vi-VN': {
    sloganLine1: 'Tạo bài học thu hút',
    sloganLine2: 'học sinh ngay từ',
    sloganHighlight: 'phút đầu tiên',
    cta: 'Tạo bài học từ chương trình',
    chipControls: 'Tinh chỉnh',
    chipLessonHelp: 'Hỗ trợ bài học',
    chipUploadClass: 'Tải chương lên',
    featureInteractive: 'Nội dung tương tác',
    featureCustom: 'Bài học riêng biệt',
    featureAI: 'AI tiên tiến',
    featureFun: 'Trải nghiệm học thú vị',
  },
  'zh-CN': {
    sloganLine1: '打造从第一分钟就',
    sloganLine2: '抓住学生的',
    sloganHighlight: '课堂',
    cta: '从课程创建一节课',
    chipControls: '微调',
    chipLessonHelp: '课程助手',
    chipUploadClass: '上传章节',
    featureInteractive: '互动内容',
    featureCustom: '量身定制',
    featureAI: '先进 AI',
    featureFun: '快乐学习体验',
  },
  'zh-TW': {
    sloganLine1: '打造從第一分鐘就',
    sloganLine2: '抓住學生的',
    sloganHighlight: '課堂',
    cta: '從課程建立一節課',
    chipControls: '微調',
    chipLessonHelp: '課程助手',
    chipUploadClass: '上傳章節',
    featureInteractive: '互動內容',
    featureCustom: '量身訂製',
    featureAI: '先進 AI',
    featureFun: '快樂學習體驗',
  },
};

const NEW_KEYS = Object.keys(KEYS['ar-SA']);
for (const [locale, values] of Object.entries(KEYS)) {
  const file = join(dir, `${locale}.json`);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.home = { ...data.home, ...values };
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`${locale}: +${NEW_KEYS.length} home keys`);
}
console.log('done');
