const crypto = require("crypto");

const FACTS = [
  ["Geography", "What is the capital of India?", "Delhi", ["Mumbai", "Kolkata", "Chennai"], "word"],
  ["Geography", "What is the capital of Japan?", "Tokyo", ["Osaka", "Kyoto", "Nagoya"], "word"],
  ["Geography", "What is the capital of France?", "Paris", ["Lyon", "Marseille", "Nice"], "word"],
  ["Geography", "Which continent contains Brazil?", "South America", ["Europe", "Asia", "Africa"], "phrase"],
  ["Geography", "Which ocean is the largest?", "Pacific", ["Atlantic", "Indian", "Arctic"], "word"],
  ["Science", "Which planet is known as the Red Planet?", "Mars", ["Venus", "Jupiter", "Mercury"], "word"],
  ["Science", "What gas do plants absorb from the air?", "Carbon dioxide", ["Oxygen", "Nitrogen", "Helium"], "phrase"],
  ["Science", "How many bones are in a typical adult human body?", "206", ["201", "212", "220"], "number"],
  ["Science", "What is H2O commonly called?", "Water", ["Salt", "Oxygen", "Hydrogen"], "word"],
  ["Science", "Which force pulls objects toward Earth?", "Gravity", ["Friction", "Magnetism", "Pressure"], "word"],
  ["History", "Who wrote the Indian national anthem?", "Rabindranath Tagore", ["Bankim Chandra Chatterjee", "Sarojini Naidu", "Subhas Chandra Bose"], "phrase"],
  ["History", "Which ancient civilization built the pyramids of Giza?", "Egyptians", ["Romans", "Vikings", "Mayans"], "word"],
  ["History", "In which country did the Olympic Games begin?", "Greece", ["Italy", "Egypt", "France"], "word"],
  ["Computers", "What does CPU stand for?", "Central Processing Unit", ["Computer Power Utility", "Central Program User", "Core Processing Upload"], "phrase"],
  ["Computers", "Which language structures web pages?", "HTML", ["SQL", "Python", "C++"], "word"],
  ["Computers", "What does RAM store while programs are running?", "Temporary data", ["Printed pages", "Permanent backups", "Passwords only"], "phrase"],
  ["English", "What is a synonym of rapid?", "Fast", ["Slow", "Quiet", "Heavy"], "word"],
  ["English", "What is the opposite of ancient?", "Modern", ["Historic", "Old", "Past"], "word"],
  ["English", "Which word is a noun: quickly, blue, teacher, under?", "Teacher", ["Quickly", "Blue", "Under"], "word"],
  ["Grammar", "Choose the correct word: She ___ to school every day.", "Goes", ["Go", "Going", "Gone"], "word"],
  ["Grammar", "Choose the correct plural of child.", "Children", ["Childs", "Childes", "Childrens"], "word"],
  ["Books", "Who wrote The Jungle Book?", "Rudyard Kipling", ["Roald Dahl", "Lewis Carroll", "Mark Twain"], "phrase"],
  ["Books", "Who wrote Harry Potter?", "J K Rowling", ["Suzanne Collins", "Enid Blyton", "Jane Austen"], "phrase", ["J. K. Rowling", "JK Rowling"]],
  ["Books", "Who wrote Romeo and Juliet?", "William Shakespeare", ["Charles Dickens", "George Orwell", "Oscar Wilde"], "phrase"],
  ["Sports", "How many players does one football team have on the field?", "11", ["9", "10", "12"], "number"],
  ["Sports", "In cricket, how many runs is a boundary over the rope worth?", "6", ["4", "5", "8"], "number"],
  ["Sports", "Which sport uses a shuttlecock?", "Badminton", ["Tennis", "Squash", "Hockey"], "word"],
  ["Everyday Knowledge", "How many minutes are in two hours?", "120", ["100", "90", "140"], "number"],
  ["Everyday Knowledge", "Which direction is opposite east?", "West", ["North", "South", "Left"], "word"],
  ["Everyday Knowledge", "How many days are in a leap year?", "366", ["365", "364", "367"], "number"],
  ["Logical Reasoning", "If all roses are flowers, is every rose a flower?", "True", ["False", "Sometimes", "Unknown"], "boolean"],
  ["Logical Reasoning", "Which does not belong: square, triangle, circle, banana?", "Banana", ["Square", "Triangle", "Circle"], "word"],
  ["Riddles", "What has hands but cannot clap?", "Clock", ["Chair", "River", "Book"], "word", ["A clock"]],
  ["Riddles", "What gets wetter as it dries?", "Towel", ["Sun", "Paper", "Sand"], "word", ["A towel"]],
  ["General Knowledge", "How many colors are traditionally named in a rainbow?", "7", ["6", "8", "9"], "number"],
  ["General Knowledge", "Which instrument has black and white keys?", "Piano", ["Violin", "Flute", "Drum"], "word"],
  ["General Knowledge", "Which animal is the largest living mammal?", "Blue whale", ["Elephant", "Giraffe", "Hippopotamus"], "phrase"],
];

const WORDS = [
  ["planet", "A large body that travels around a star"], ["garden", "A place where plants are grown"],
  ["silver", "A shiny grey metal"], ["school", "A place for learning"], ["bridge", "A structure that crosses a gap"],
  ["camera", "A device used to take photographs"], ["orange", "A fruit and a color"], ["winter", "The coldest season"],
  ["rocket", "A vehicle designed for space"], ["pencil", "A tool used for writing or drawing"],
];

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function shuffle(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function normalized(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase().replace(/[.]+$/g, "");
}

function answerMatches(question, value) {
  const input = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!input || input.length > 100) return false;
  if (question.answerType === "number" && !/^-?\d+(?:\.\d+)?$/.test(input)) return false;
  if (question.answerType === "word" && !/^\p{L}+(?:['-]\p{L}+)*$/u.test(input)) return false;
  if (question.answerType === "phrase" && !/^\p{L}+(?:[ .'-]\p{L}+)*$/u.test(input)) return false;
  if (question.answerType === "boolean" && !/^(true|false)$/i.test(input)) return false;
  return question.acceptedAnswers.some((answer) => normalized(answer) === normalized(input));
}

function hintFor(answer, type) {
  if (type === "number") return `Number — ${String(answer).split("").map(() => "_").join(" ")}`;
  if (type === "boolean") return "True or false — type one word";
  return String(answer).split(" ").map((word) => word.split("").map((letter, index) => index === 0 ? letter : "_").join(" ")).join("   ");
}

function baseQuestion({ category, difficulty = "medium", question, answer, acceptedAnswers = [], answerType = "word", options = [], durationMs = 10000, sourceKey = "" }) {
  const accepted = [answer, ...acceptedAnswers].filter(Boolean);
  const uniqueChoices = [];
  for (const option of [answer, ...options]) {
    if (!uniqueChoices.some((item) => normalized(item) === normalized(option))) uniqueChoices.push(option);
  }
  const choices = options.length ? shuffle(uniqueChoices.slice(0, 4)) : [];
  return {
    id: crypto.randomUUID(), category, difficulty, question, answer: String(answer), acceptedAnswers: accepted,
    answerType, hint: hintFor(answer, answerType), durationMs, options: choices,
    correctOption: choices.length ? choices.findIndex((item) => normalized(item) === normalized(answer)) : null,
    sourceKey: sourceKey || `${category}:${normalized(question)}`, createdAt: new Date().toISOString(),
  };
}

function factQuestion() {
  const [category, question, answer, wrong, answerType, equivalents = []] = pick(FACTS);
  return baseQuestion({ category, question, answer, acceptedAnswers: equivalents, answerType, options: wrong });
}

function mathQuestion() {
  const mode = pick(["add", "subtract", "multiply", "divide", "percent", "sequence"]);
  if (mode === "add") {
    const a = randomInt(12, 99); const b = randomInt(11, 90); const answer = a + b;
    return baseQuestion({ category: "Mathematics", question: `What is ${a} + ${b}?`, answer, answerType: "number", options: [answer - 2, answer + 3, answer + 10], sourceKey: `math:add:${a}:${b}` });
  }
  if (mode === "subtract") {
    const a = randomInt(50, 150); const b = randomInt(10, a - 5); const answer = a - b;
    return baseQuestion({ category: "Mathematics", question: `What is ${a} - ${b}?`, answer, answerType: "number", options: [answer - 5, answer + 5, answer + 10], sourceKey: `math:sub:${a}:${b}` });
  }
  if (mode === "multiply") {
    const a = randomInt(3, 15); const b = randomInt(3, 12); const answer = a * b;
    return baseQuestion({ category: "Mathematics", question: `What is ${a} × ${b}?`, answer, answerType: "number", options: [answer - a, answer + b, answer + a], sourceKey: `math:mul:${a}:${b}` });
  }
  if (mode === "divide") {
    const answer = randomInt(3, 15); const divisor = randomInt(2, 10); const total = answer * divisor;
    return baseQuestion({ category: "Mathematics", question: `What is ${total} ÷ ${divisor}?`, answer, answerType: "number", options: [answer - 1, answer + 1, answer + divisor], sourceKey: `math:div:${total}:${divisor}` });
  }
  if (mode === "percent") {
    const percent = pick([10, 20, 25, 50]); const total = pick([40, 60, 80, 100, 120, 200]); const answer = total * percent / 100;
    return baseQuestion({ category: "Mathematics", question: `What is ${percent}% of ${total}?`, answer, answerType: "number", options: [answer + 5, Math.max(1, answer - 5), answer * 2], sourceKey: `math:percent:${percent}:${total}` });
  }
  const start = randomInt(1, 12); const step = randomInt(2, 9); const sequence = [start, start + step, start + step * 2, start + step * 3]; const answer = start + step * 4;
  return baseQuestion({ category: "Pattern Recognition", question: `What comes next: ${sequence.join(", ")}, ?`, answer, answerType: "number", options: [answer - step, answer + step, answer + 2], sourceKey: `sequence:${start}:${step}` });
}

function scrambleQuestion() {
  const [answer, clue] = pick(WORDS);
  let scrambled = shuffle(answer.split("")).join("");
  if (scrambled === answer) scrambled = answer.slice(1) + answer[0];
  const wrong = shuffle(WORDS.filter(([word]) => word !== answer)).slice(0, 3).map(([word]) => word);
  return baseQuestion({ category: "Word Scramble", question: `Unscramble “${scrambled}”. Clue: ${clue}.`, answer, answerType: "word", options: wrong, sourceKey: `scramble:${answer}:${scrambled}` });
}

function generateQuestion({ contest = false, recentKeys = [] } = {}) {
  const recent = new Set(recentKeys);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const question = pick([factQuestion, factQuestion, mathQuestion, mathQuestion, scrambleQuestion])();
    if (!recent.has(question.sourceKey) && (!contest || question.options.length === 4)) return question;
  }
  const fallback = mathQuestion();
  fallback.sourceKey = `${fallback.sourceKey}:${Date.now()}`;
  return fallback;
}

function generateContestSet(count = 20, recentKeys = []) {
  const questions = [];
  const keys = [...recentKeys];
  while (questions.length < count) {
    const question = generateQuestion({ contest: true, recentKeys: keys });
    questions.push(question); keys.push(question.sourceKey);
  }
  return questions;
}

function publicQuestion(question, extra = {}) {
  if (!question) return null;
  return {
    id: question.id, category: question.category, difficulty: question.difficulty, question: question.question,
    answerType: question.answerType, hint: question.hint, durationMs: question.durationMs,
    ...(question.options?.length ? { options: question.options } : {}), ...extra,
  };
}

module.exports = { FACTS, normalized, answerMatches, generateQuestion, generateContestSet, publicQuestion };
