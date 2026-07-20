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
  ["Space Science", "Which star is closest to Earth?", "Sun", ["Sirius", "Polaris", "Vega"], "word", ["The Sun"]],
  ["Space Science", "Which is the largest planet in our solar system?", "Jupiter", ["Saturn", "Earth", "Neptune"], "word"],
  ["Space Science", "Which planet is famous for its bright rings?", "Saturn", ["Mars", "Venus", "Mercury"], "word"],
  ["Space Science", "Which planet is the hottest in our solar system?", "Venus", ["Mercury", "Mars", "Jupiter"], "word"],
  ["Space Science", "How many natural moons does Earth have?", "1", ["0", "2", "3"], "number"],
  ["Space Science", "How many moons does Mars have?", "2", ["1", "3", "4"], "number"],
  ["Space Science", "What galaxy contains our solar system?", "Milky Way", ["Andromeda", "Triangulum", "Whirlpool"], "phrase", ["The Milky Way"]],
  ["Space Science", "What is the name of Earth's natural satellite?", "Moon", ["Titan", "Europa", "Phobos"], "word", ["The Moon"]],
  ["Space Science", "Which planet is closest to the Sun?", "Mercury", ["Venus", "Earth", "Mars"], "word"],
  ["Space Science", "Which planet is farthest from the Sun?", "Neptune", ["Uranus", "Saturn", "Jupiter"], "word"],
  ["Space Science", "Who was the first human to travel into space?", "Yuri Gagarin", ["Neil Armstrong", "Buzz Aldrin", "John Glenn"], "phrase"],
  ["Space Science", "Which mission first landed humans on the Moon?", "Apollo 11", ["Apollo 8", "Voyager 1", "Gemini 4"], "phrase", ["Apollo Eleven"]],
  ["Space Science", "What does a light-year measure?", "Distance", ["Time", "Brightness", "Mass"], "word"],
  ["Space Science", "What is a rocky object that enters Earth's atmosphere called?", "Meteor", ["Comet", "Moon", "Planet"], "word"],
  ["Space Science", "What force keeps planets in orbit around the Sun?", "Gravity", ["Friction", "Electricity", "Pressure"], "word"],
  ["Chemistry", "What is the atomic number of oxygen?", "8", ["6", "7", "9"], "number"],
  ["Chemistry", "What is the atomic number of carbon?", "6", ["5", "7", "8"], "number"],
  ["Chemistry", "Which element has the symbol Au?", "Gold", ["Silver", "Argon", "Copper"], "word"],
  ["Chemistry", "Which element has the symbol Fe?", "Iron", ["Fluorine", "Francium", "Lead"], "word"],
  ["Chemistry", "Which element has the symbol Na?", "Sodium", ["Nitrogen", "Neon", "Nickel"], "word"],
  ["Chemistry", "What is the common name of sodium chloride?", "Salt", ["Sugar", "Vinegar", "Lime"], "word", ["Table salt"]],
  ["Chemistry", "What pH value is neutral at room temperature?", "7", ["0", "5", "14"], "number"],
  ["Chemistry", "Which gas is most abundant in Earth's atmosphere?", "Nitrogen", ["Oxygen", "Carbon dioxide", "Hydrogen"], "word"],
  ["Chemistry", "Which is the lightest chemical element?", "Hydrogen", ["Helium", "Lithium", "Oxygen"], "word"],
  ["Chemistry", "What element are diamonds made from?", "Carbon", ["Silicon", "Calcium", "Iron"], "word"],
  ["Chemistry", "Which scientist created the first widely recognized periodic table?", "Dmitri Mendeleev", ["Marie Curie", "Niels Bohr", "John Dalton"], "phrase", ["Mendeleev"]],
  ["Chemistry", "Acids turn blue litmus paper which color?", "Red", ["Green", "White", "Yellow"], "word"],
  ["Chemistry", "How many hydrogen atoms are in one water molecule?", "2", ["1", "3", "4"], "number"],
  ["Chemistry", "Which state of matter has a fixed volume but no fixed shape?", "Liquid", ["Solid", "Gas", "Plasma"], "word"],
  ["Chemistry", "What process changes a liquid into a gas?", "Evaporation", ["Freezing", "Condensation", "Melting"], "word"],
  ["Physics", "What is the SI unit of force?", "Newton", ["Joule", "Watt", "Pascal"], "word"],
  ["Physics", "What is the SI unit of energy?", "Joule", ["Newton", "Watt", "Volt"], "word"],
  ["Physics", "What is the SI unit of power?", "Watt", ["Ampere", "Joule", "Ohm"], "word"],
  ["Physics", "What is the SI unit of electric current?", "Ampere", ["Volt", "Watt", "Tesla"], "word"],
  ["Physics", "What is the SI unit of frequency?", "Hertz", ["Pascal", "Kelvin", "Newton"], "word"],
  ["Physics", "Which travels faster in a vacuum: light or sound?", "Light", ["Sound", "Both", "Neither"], "word"],
  ["Physics", "Can sound travel through a perfect vacuum?", "False", ["True", "Sometimes", "Only slowly"], "boolean"],
  ["Physics", "What instrument measures temperature?", "Thermometer", ["Barometer", "Ammeter", "Speedometer"], "word"],
  ["Physics", "What type of energy does a moving object have?", "Kinetic energy", ["Chemical energy", "Nuclear energy", "Potential energy"], "phrase"],
  ["Physics", "What simple machine is a ramp?", "Inclined plane", ["Lever", "Pulley", "Wheel"], "phrase"],
  ["Physics", "Which color of visible light has the longest wavelength?", "Red", ["Blue", "Violet", "Green"], "word"],
  ["Physics", "Which mirror curves inward?", "Concave", ["Convex", "Plane", "Flat"], "word"],
  ["Physics", "What is the approximate acceleration due to gravity on Earth in metres per second squared?", "9.8", ["4.9", "19.6", "98"], "number"],
  ["Physics", "Which law says every action has an equal and opposite reaction?", "Newtons third law", ["Ohms law", "Hookes law", "Boyles law"], "phrase", ["Newton's third law", "Newton third law"]],
  ["Physics", "What happens to light when it bounces off a mirror?", "Reflection", ["Refraction", "Diffusion", "Conduction"], "word"],
  ["Logical Reasoning", "What comes next: 2, 4, 8, 16, ?", "32", ["24", "30", "34"], "number"],
  ["Logical Reasoning", "What comes next: 1, 4, 9, 16, ?", "25", ["20", "24", "36"], "number"],
  ["Logical Reasoning", "If today is Monday, what day is two days later?", "Wednesday", ["Tuesday", "Thursday", "Friday"], "word"],
  ["Logical Reasoning", "Which number does not belong: 2, 4, 6, 9?", "9", ["2", "4", "6"], "number"],
  ["Logical Reasoning", "A book is to reading as a fork is to what?", "Eating", ["Sleeping", "Driving", "Painting"], "word"],
  ["Logical Reasoning", "If all cats are animals and Miso is a cat, is Miso an animal?", "True", ["False", "Sometimes", "Unknown"], "boolean"],
  ["Logical Reasoning", "Which shape has no corners?", "Circle", ["Square", "Triangle", "Rectangle"], "word"],
  ["Logical Reasoning", "What comes next: A, C, E, G, ?", "I", ["H", "J", "K"], "word"],
  ["Logical Reasoning", "If five pencils cost 25 rupees equally, what does one pencil cost?", "5", ["4", "6", "10"], "number"],
  ["Logical Reasoning", "Which is heavier: one kilogram of iron or one kilogram of cotton?", "Equal", ["Iron", "Cotton", "Unknown"], "word", ["Same"]],
  ["Logical Reasoning", "What comes next: 3, 6, 12, 24, ?", "48", ["30", "36", "42"], "number"],
  ["Logical Reasoning", "If some birds can fly, does it follow that every bird can fly?", "False", ["True", "Always", "Unknown"], "boolean"],
  ["Logical Reasoning", "Which word does not belong: apple, mango, carrot, banana?", "Carrot", ["Apple", "Mango", "Banana"], "word"],
  ["Logical Reasoning", "A clock shows 3:00. What angle is between its hands?", "90", ["45", "60", "180"], "number"],
  ["Logical Reasoning", "If you face north and turn right, which direction do you face?", "East", ["West", "South", "North"], "word"],
  ["General Knowledge", "What is the capital of Australia?", "Canberra", ["Sydney", "Melbourne", "Perth"], "word"],
  ["General Knowledge", "What is the capital of Canada?", "Ottawa", ["Toronto", "Vancouver", "Montreal"], "word"],
  ["General Knowledge", "Which country is home to the Great Pyramid of Giza?", "Egypt", ["Mexico", "Greece", "Peru"], "word"],
  ["General Knowledge", "Which is the largest continent by area?", "Asia", ["Africa", "Europe", "Antarctica"], "word"],
  ["General Knowledge", "Which is the smallest continent by land area?", "Australia", ["Europe", "Antarctica", "South America"], "word"],
  ["General Knowledge", "What currency is used in Japan?", "Yen", ["Won", "Yuan", "Baht"], "word"],
  ["General Knowledge", "Which organ pumps blood through the human body?", "Heart", ["Liver", "Lung", "Kidney"], "word"],
  ["General Knowledge", "Which is the largest organ of the human body?", "Skin", ["Liver", "Heart", "Brain"], "word"],
  ["General Knowledge", "How many sides does a hexagon have?", "6", ["5", "7", "8"], "number"],
  ["General Knowledge", "Which language has the most native speakers worldwide?", "Mandarin Chinese", ["English", "Spanish", "Hindi"], "phrase", ["Mandarin"]],
  ["General Knowledge", "What is the tallest land animal?", "Giraffe", ["Elephant", "Camel", "Horse"], "word"],
  ["General Knowledge", "Which country gifted the Statue of Liberty to the United States?", "France", ["Britain", "Spain", "Canada"], "word"],
  ["General Knowledge", "Which musical instrument normally has six strings?", "Guitar", ["Flute", "Piano", "Trumpet"], "word"],
  ["General Knowledge", "How many months have 31 days?", "7", ["5", "6", "8"], "number"],
  ["General Knowledge", "Which vitamin is produced in skin exposed to sunlight?", "Vitamin D", ["Vitamin A", "Vitamin B", "Vitamin C"], "phrase"],
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
  if (question.answerType === "phrase" && !/^[\p{L}\p{N}]+(?:[ .'-][\p{L}\p{N}]+)*$/u.test(input)) return false;
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

function factQuestion(categoryName = "") {
  const pool = categoryName ? FACTS.filter(([category]) => category === categoryName) : FACTS;
  const [category, question, answer, wrong, answerType, equivalents = []] = pick(pool.length ? pool : FACTS);
  return baseQuestion({ category, question, answer, acceptedAnswers: equivalents, answerType, options: wrong });
}

function mathQuestion() {
  const mode = pick(["add", "subtract", "multiply", "divide", "percent", "sequence", "square", "average", "equation", "perimeter"]);
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
  if (mode === "square") {
    const value = randomInt(4, 20); const answer = value * value;
    return baseQuestion({ category: "Mathematics", question: `What is ${value} squared?`, answer, answerType: "number", options: [answer - value, answer + value, (value + 1) * (value + 1)], sourceKey: `math:square:${value}` });
  }
  if (mode === "average") {
    const start = randomInt(4, 30); const step = randomInt(2, 10); const answer = start + step;
    return baseQuestion({ category: "Mathematics", question: `What is the average of ${start}, ${start + step}, and ${start + step * 2}?`, answer, answerType: "number", options: [start, start + step * 2, answer + step * 2], sourceKey: `math:average:${start}:${step}` });
  }
  if (mode === "equation") {
    const answer = randomInt(3, 30); const add = randomInt(4, 20); const total = answer + add;
    return baseQuestion({ category: "Algebra", question: `If x + ${add} = ${total}, what is x?`, answer, answerType: "number", options: [answer - 2, answer + 2, total], sourceKey: `math:equation:${answer}:${add}` });
  }
  if (mode === "perimeter") {
    const width = randomInt(3, 9); const length = width + randomInt(2, 8); const answer = 2 * (length + width);
    return baseQuestion({ category: "Geometry", question: `What is the perimeter of a rectangle ${length} cm long and ${width} cm wide?`, answer, answerType: "number", options: [length + width, 2 * length + width, length + 2 * width], sourceKey: `math:perimeter:${length}:${width}` });
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
    const question = pick([factQuestion, factQuestion, factQuestion, factQuestion, factQuestion, factQuestion, mathQuestion, mathQuestion, mathQuestion, scrambleQuestion])();
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
