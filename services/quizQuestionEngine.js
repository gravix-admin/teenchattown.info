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

function baseQuestion({ category, difficulty = "easy", question, answer, acceptedAnswers = [], answerType = "word", options = [], durationMs = 10000, sourceKey = "" }) {
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

function factQuestion(difficulty = "easy", categoryName = "") {
  const pool = categoryName ? FACTS.filter(([category]) => category === categoryName) : FACTS;
  const [category, question, answer, wrong, answerType, equivalents = []] = pick(pool.length ? pool : FACTS);
  return baseQuestion({ category, difficulty, question, answer, acceptedAnswers: equivalents, answerType, options: wrong });
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

const ELEMENTS = [
  ["Hydrogen", "H", 1], ["Helium", "He", 2], ["Lithium", "Li", 3], ["Beryllium", "Be", 4],
  ["Boron", "B", 5], ["Carbon", "C", 6], ["Nitrogen", "N", 7], ["Oxygen", "O", 8],
  ["Fluorine", "F", 9], ["Neon", "Ne", 10], ["Sodium", "Na", 11], ["Magnesium", "Mg", 12],
  ["Aluminium", "Al", 13], ["Silicon", "Si", 14], ["Phosphorus", "P", 15], ["Sulfur", "S", 16],
  ["Chlorine", "Cl", 17], ["Argon", "Ar", 18], ["Potassium", "K", 19], ["Calcium", "Ca", 20],
  ["Scandium", "Sc", 21], ["Titanium", "Ti", 22], ["Vanadium", "V", 23], ["Chromium", "Cr", 24],
  ["Manganese", "Mn", 25], ["Iron", "Fe", 26], ["Cobalt", "Co", 27], ["Nickel", "Ni", 28],
  ["Copper", "Cu", 29], ["Zinc", "Zn", 30], ["Gallium", "Ga", 31], ["Germanium", "Ge", 32],
  ["Arsenic", "As", 33], ["Selenium", "Se", 34], ["Bromine", "Br", 35], ["Krypton", "Kr", 36],
  ["Rubidium", "Rb", 37], ["Strontium", "Sr", 38], ["Silver", "Ag", 47], ["Tin", "Sn", 50],
  ["Iodine", "I", 53], ["Xenon", "Xe", 54], ["Cesium", "Cs", 55], ["Barium", "Ba", 56],
  ["Tungsten", "W", 74], ["Platinum", "Pt", 78], ["Gold", "Au", 79], ["Mercury", "Hg", 80],
  ["Lead", "Pb", 82], ["Uranium", "U", 92],
];

const PHYSICS_UNITS = [
  ["force", "newton", "N"], ["energy", "joule", "J"], ["power", "watt", "W"],
  ["pressure", "pascal", "Pa"], ["electric current", "ampere", "A"], ["voltage", "volt", "V"],
  ["resistance", "ohm", "ohm"], ["frequency", "hertz", "Hz"], ["electric charge", "coulomb", "C"],
  ["magnetic flux density", "tesla", "T"], ["capacitance", "farad", "F"], ["inductance", "henry", "H"],
];

const PLANETS = [
  ["Mercury", 1, 0], ["Venus", 2, 0], ["Earth", 3, 1], ["Mars", 4, 2],
  ["Jupiter", 5, 95], ["Saturn", 6, 146], ["Uranus", 7, 28], ["Neptune", 8, 16],
];

const DIFFICULTY_CYCLE = ["easy", "moderate", "easy", "difficult", "easy", "moderate", "easy", "difficult", "easy", "moderate"];
let difficultyIndex = randomInt(0, DIFFICULTY_CYCLE.length - 1);

function nextDifficulty() {
  const difficulty = DIFFICULTY_CYCLE[difficultyIndex % DIFFICULTY_CYCLE.length];
  difficultyIndex += 1;
  return difficulty;
}

function numericOptions(answer, spread = 4) {
  const value = Number(answer);
  const candidates = [value + spread, value - spread, value + spread * 2, value - spread * 2, value + 1, value - 1, value + 10, Math.max(0, value - 10), value * 2];
  return [...new Set(candidates.filter((item) => Number.isFinite(item) && item !== value))].slice(0, 3);
}

function otherValues(items, answer, selector = (item) => item) {
  return shuffle(items.map(selector).filter((item) => normalized(item) !== normalized(answer))).slice(0, 3);
}

function gcd(a, b) {
  let left = Math.abs(a); let right = Math.abs(b);
  while (right) [left, right] = [right, left % right];
  return left;
}

function freshMathQuestion(difficulty = "easy") {
  const modes = difficulty === "easy"
    ? ["add", "subtract", "multiply", "divide", "fraction"]
    : difficulty === "moderate"
      ? ["percent", "sequence", "square", "average", "equation", "perimeter", "area", "ratio"]
      : ["compound", "linear", "power", "gcd", "lcm", "increase", "ratioShare", "squareRoot"];
  const mode = pick(modes);
  let question; let answer; let sourceKey; let category = "Mathematics"; let spread = 4;

  if (mode === "add") {
    const a = randomInt(20, 999); const b = randomInt(20, 999); answer = a + b;
    question = `What is ${a} + ${b}?`; sourceKey = `math:add:${a}:${b}`; spread = randomInt(2, 12);
  } else if (mode === "subtract") {
    const a = randomInt(100, 1500); const b = randomInt(10, a - 5); answer = a - b;
    question = `What is ${a} - ${b}?`; sourceKey = `math:sub:${a}:${b}`; spread = randomInt(2, 12);
  } else if (mode === "multiply") {
    const a = randomInt(3, 35); const b = randomInt(3, 25); answer = a * b;
    question = `What is ${a} × ${b}?`; sourceKey = `math:mul:${a}:${b}`; spread = Math.max(2, Math.min(a, b));
  } else if (mode === "divide") {
    answer = randomInt(3, 60); const divisor = randomInt(2, 25); const total = answer * divisor;
    question = `What is ${total} ÷ ${divisor}?`; sourceKey = `math:div:${total}:${divisor}`; spread = randomInt(1, 6);
  } else if (mode === "fraction") {
    const denominator = pick([2, 3, 4, 5, 6, 8, 10]); const numerator = randomInt(1, denominator - 1); const unit = randomInt(2, 50); const total = denominator * unit; answer = numerator * unit;
    question = `What is ${numerator}/${denominator} of ${total}?`; sourceKey = `math:fraction:${numerator}:${denominator}:${total}`; spread = unit;
  } else if (mode === "percent") {
    const percent = pick([5, 10, 12.5, 15, 20, 25, 30, 40, 50, 75]); const multiplier = Number.isInteger(percent) ? 100 : 200; const total = randomInt(1, 30) * multiplier; answer = total * percent / 100;
    question = `What is ${percent}% of ${total}?`; sourceKey = `math:percent:${percent}:${total}`; spread = Math.max(2, total / 100);
  } else if (mode === "sequence") {
    const start = randomInt(1, 80); const step = randomInt(2, 24); const terms = [start, start + step, start + step * 2, start + step * 3]; answer = start + step * 4;
    question = `What comes next: ${terms.join(", ")}, ?`; sourceKey = `math:sequence:${start}:${step}`; spread = step;
  } else if (mode === "square") {
    const value = randomInt(8, 45); answer = value * value; question = `What is ${value} squared?`; sourceKey = `math:square:${value}`; spread = value;
  } else if (mode === "average") {
    const middle = randomInt(10, 150); const step = randomInt(2, 30); answer = middle;
    question = `What is the average of ${middle - step}, ${middle}, and ${middle + step}?`; sourceKey = `math:average:${middle}:${step}`; spread = step;
  } else if (mode === "equation") {
    answer = randomInt(4, 100); const add = randomInt(5, 80); const total = answer + add; category = "Algebra";
    question = `If x + ${add} = ${total}, what is x?`; sourceKey = `math:equation:${answer}:${add}`; spread = randomInt(2, 8);
  } else if (mode === "perimeter") {
    const width = randomInt(3, 40); const length = randomInt(width + 1, width + 50); answer = 2 * (length + width); category = "Geometry";
    question = `Find the perimeter of a ${length} cm by ${width} cm rectangle.`; sourceKey = `math:perimeter:${length}:${width}`; spread = 2 * width;
  } else if (mode === "area") {
    const width = randomInt(3, 35); const length = randomInt(4, 45); answer = length * width; category = "Geometry";
    question = `Find the area of a ${length} cm by ${width} cm rectangle.`; sourceKey = `math:area:${length}:${width}`; spread = width;
  } else if (mode === "ratio") {
    const left = randomInt(2, 12); const right = randomInt(2, 12); const scale = randomInt(3, 30); answer = right * scale;
    question = `A ratio is ${left}:${right}. If the first value is ${left * scale}, what is the second?`; sourceKey = `math:ratio:${left}:${right}:${scale}`; spread = scale;
  } else if (mode === "compound") {
    const a = randomInt(12, 80); const b = randomInt(3, 20); const c = randomInt(2, 14); answer = a + b * c;
    question = `Using order of operations, what is ${a} + ${b} × ${c}?`; sourceKey = `math:compound:${a}:${b}:${c}`; spread = b;
  } else if (mode === "linear") {
    answer = randomInt(3, 60); const coefficient = randomInt(2, 12); const add = randomInt(5, 70); const total = coefficient * answer + add; category = "Algebra";
    question = `Solve ${coefficient}x + ${add} = ${total}. What is x?`; sourceKey = `math:linear:${coefficient}:${add}:${total}`; spread = coefficient;
  } else if (mode === "power") {
    const base = randomInt(2, 12); const exponent = randomInt(3, 5); answer = base ** exponent;
    question = `What is ${base} to the power of ${exponent}?`; sourceKey = `math:power:${base}:${exponent}`; spread = base ** (exponent - 1);
  } else if (mode === "gcd" || mode === "lcm") {
    const factor = randomInt(2, 18); const leftMultiplier = pick([2, 3, 5, 7]); const rightMultiplier = pick([4, 5, 7, 11]); const a = factor * leftMultiplier; const b = factor * rightMultiplier;
    answer = mode === "gcd" ? gcd(a, b) : Math.abs(a * b) / gcd(a, b);
    question = `What is the ${mode === "gcd" ? "greatest common divisor" : "least common multiple"} of ${a} and ${b}?`; sourceKey = `math:${mode}:${a}:${b}`; spread = factor;
  } else if (mode === "increase") {
    const original = randomInt(20, 500); const percent = pick([10, 20, 25, 50, 75, 100]); answer = original * (100 + percent) / 100;
    question = `${original} is increased by ${percent}%. What is the new value?`; sourceKey = `math:increase:${original}:${percent}`; spread = Math.max(2, original * percent / 100);
  } else if (mode === "ratioShare") {
    const a = randomInt(2, 9); const b = randomInt(2, 9); const unit = randomInt(5, 40); const total = (a + b) * unit; answer = a * unit;
    question = `${total} is divided in the ratio ${a}:${b}. What is the first share?`; sourceKey = `math:ratio-share:${total}:${a}:${b}`; spread = unit;
  } else {
    const root = randomInt(8, 60); answer = root; question = `What is the square root of ${root * root}?`; sourceKey = `math:sqrt:${root}`; spread = randomInt(2, 8);
  }
  return baseQuestion({ category, difficulty, question, answer, answerType: "number", options: numericOptions(answer, spread), sourceKey });
}

function scienceCalculation(difficulty = "easy") {
  const modes = difficulty === "easy" ? ["speed", "force", "voltage"] : difficulty === "moderate" ? ["work", "power", "density", "charge"] : ["kinetic", "potential", "wave", "pressure"];
  const mode = pick(modes);
  let question; let answer; let sourceKey; let spread = 2;
  if (mode === "speed") {
    const time = randomInt(2, 40); const speed = randomInt(3, 80); const distance = time * speed; answer = speed; question = `An object travels ${distance} m in ${time} s. What is its speed in m/s?`; sourceKey = `physics:speed:${distance}:${time}`; spread = randomInt(1, 6);
  } else if (mode === "force") {
    const mass = randomInt(2, 50); const acceleration = randomInt(2, 20); answer = mass * acceleration; question = `What force in newtons accelerates ${mass} kg at ${acceleration} m/s²?`; sourceKey = `physics:force:${mass}:${acceleration}`; spread = mass;
  } else if (mode === "voltage") {
    const current = randomInt(2, 20); const resistance = randomInt(2, 30); answer = current * resistance; question = `Using V = IR, find the voltage when current is ${current} A and resistance is ${resistance} ohms.`; sourceKey = `physics:voltage:${current}:${resistance}`; spread = resistance;
  } else if (mode === "work") {
    const force = randomInt(5, 100); const distance = randomInt(2, 40); answer = force * distance; question = `How much work in joules is done by a ${force} N force over ${distance} m?`; sourceKey = `physics:work:${force}:${distance}`; spread = force;
  } else if (mode === "power") {
    const seconds = randomInt(2, 30); const power = randomInt(10, 200); const work = seconds * power; answer = power; question = `${work} J of work is done in ${seconds} s. What is the power in watts?`; sourceKey = `physics:power:${work}:${seconds}`; spread = randomInt(2, 10);
  } else if (mode === "density") {
    const volume = randomInt(2, 30); const density = randomInt(2, 25); const mass = volume * density; answer = density; question = `A sample has mass ${mass} g and volume ${volume} cm³. What is its density in g/cm³?`; sourceKey = `physics:density:${mass}:${volume}`; spread = randomInt(1, 4);
  } else if (mode === "charge") {
    const seconds = randomInt(2, 50); const current = randomInt(2, 25); answer = seconds * current; question = `A current of ${current} A flows for ${seconds} s. How much charge passes in coulombs?`; sourceKey = `physics:charge:${current}:${seconds}`; spread = current;
  } else if (mode === "kinetic") {
    const mass = randomInt(2, 30); const speed = randomInt(2, 20); answer = mass * speed * speed / 2; question = `Find the kinetic energy in joules of a ${mass} kg object moving at ${speed} m/s.`; sourceKey = `physics:kinetic:${mass}:${speed}`; spread = mass * speed;
  } else if (mode === "potential") {
    const mass = randomInt(2, 30); const height = randomInt(2, 40); answer = mass * 10 * height; question = `Using g = 10 m/s², find the potential energy of ${mass} kg at a height of ${height} m.`; sourceKey = `physics:potential:${mass}:${height}`; spread = mass * 10;
  } else if (mode === "wave") {
    const frequency = randomInt(2, 80); const wavelength = randomInt(2, 25); answer = frequency * wavelength; question = `A wave has frequency ${frequency} Hz and wavelength ${wavelength} m. What is its speed in m/s?`; sourceKey = `physics:wave:${frequency}:${wavelength}`; spread = frequency;
  } else {
    const area = randomInt(2, 50); const pressure = randomInt(10, 200); const force = area * pressure; answer = pressure; question = `A force of ${force} N acts on ${area} m². What is the pressure in pascals?`; sourceKey = `physics:pressure:${force}:${area}`; spread = randomInt(2, 10);
  }
  return baseQuestion({ category: "Physics", difficulty, question, answer, answerType: "number", options: numericOptions(answer, spread), sourceKey });
}

function scienceFactQuestion(difficulty = "easy") {
  const mode = pick(["symbol", "number", "element", "unit", "unitSymbol", "planetOrder", "planetMoons"]);
  if (["symbol", "number", "element"].includes(mode)) {
    const [name, symbol, atomicNumber] = pick(ELEMENTS);
    if (mode === "symbol") return baseQuestion({ category: "Chemistry", difficulty, question: `What is the chemical symbol for ${name}?`, answer: symbol, answerType: "word", options: otherValues(ELEMENTS, symbol, (item) => item[1]), sourceKey: `chem:symbol:${name}` });
    if (mode === "number") return baseQuestion({ category: "Chemistry", difficulty, question: `What is the atomic number of ${name}?`, answer: atomicNumber, answerType: "number", options: numericOptions(atomicNumber, randomInt(1, 4)), sourceKey: `chem:number:${name}` });
    return baseQuestion({ category: "Chemistry", difficulty, question: `Which element has the symbol ${symbol}?`, answer: name, answerType: "word", options: otherValues(ELEMENTS, name, (item) => item[0]), sourceKey: `chem:element:${symbol}` });
  }
  if (mode === "unit" || mode === "unitSymbol") {
    const [quantity, unit, symbol] = pick(PHYSICS_UNITS);
    if (mode === "unit") return baseQuestion({ category: "Physics", difficulty, question: `What is the SI unit of ${quantity}?`, answer: unit, answerType: "word", options: otherValues(PHYSICS_UNITS, unit, (item) => item[1]), sourceKey: `physics:unit:${quantity}` });
    return baseQuestion({ category: "Physics", difficulty, question: `What is the standard symbol for the ${unit}?`, answer: symbol, answerType: "phrase", options: otherValues(PHYSICS_UNITS, symbol, (item) => item[2]), sourceKey: `physics:unit-symbol:${unit}` });
  }
  const [planet, order, moons] = pick(PLANETS);
  if (mode === "planetOrder") return baseQuestion({ category: "Space Science", difficulty, question: `What position is ${planet} from the Sun?`, answer: order, answerType: "number", options: numericOptions(order, 1), sourceKey: `space:order:${planet}` });
  return baseQuestion({ category: "Space Science", difficulty, question: `How many confirmed moons does ${planet} have in this quiz's reference set?`, answer: moons, answerType: "number", options: numericOptions(moons, Math.max(1, randomInt(1, 8))), sourceKey: `space:moons:${planet}` });
}

function scienceQuestion(difficulty = "easy") {
  return Math.random() < 0.82 ? scienceCalculation(difficulty) : scienceFactQuestion(difficulty);
}

function reasoningQuestion(difficulty = "easy") {
  const mode = difficulty === "difficult" ? pick(["alternating", "fibonacci", "growing"]) : pick(["arithmetic", "growing", "fibonacci"]);
  let terms; let answer; let sourceKey;
  if (mode === "arithmetic") {
    const start = randomInt(1, 100); const step = randomInt(2, 25); terms = [start, start + step, start + step * 2, start + step * 3]; answer = start + step * 4; sourceKey = `reason:arithmetic:${start}:${step}`;
  } else if (mode === "fibonacci") {
    const a = randomInt(1, 30); const b = randomInt(a + 1, a + 30); terms = [a, b, a + b, a + 2 * b]; answer = 2 * a + 3 * b; sourceKey = `reason:fibonacci:${a}:${b}`;
  } else if (mode === "alternating") {
    const start = randomInt(10, 100); const up = randomInt(5, 30); const down = randomInt(2, up - 1); terms = [start, start + up, start + up - down, start + 2 * up - down]; answer = start + 2 * up - 2 * down; sourceKey = `reason:alternating:${start}:${up}:${down}`;
  } else {
    const start = randomInt(1, 50); const step = randomInt(1, 10); terms = [start, start + step, start + step * 3, start + step * 6]; answer = start + step * 10; sourceKey = `reason:growing:${start}:${step}`;
  }
  return baseQuestion({ category: "Logical Reasoning", difficulty, question: `Find the next number: ${terms.join(", ")}, ?`, answer, answerType: "number", options: numericOptions(answer, randomInt(2, 10)), sourceKey });
}

function scrambleQuestion(difficulty = "easy") {
  const [answer, clue] = pick(WORDS);
  let scrambled = shuffle(answer.split("")).join("");
  if (scrambled === answer) scrambled = answer.slice(1) + answer[0];
  const wrong = shuffle(WORDS.filter(([word]) => word !== answer)).slice(0, 3).map(([word]) => word);
  return baseQuestion({ category: "Word Scramble", question: `Unscramble “${scrambled}”. Clue: ${clue}.`, answer, answerType: "word", options: wrong, sourceKey: `scramble:${answer}:${scrambled}` });
}

function generateQuestion({ contest = false, recentKeys = [] } = {}) {
  const recent = new Set(recentKeys);
  const difficulty = nextDifficulty();
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const roll = Math.random();
    const question = roll < 0.53
      ? freshMathQuestion(difficulty)
      : roll < 0.87
        ? scienceQuestion(difficulty)
        : roll < 0.97
          ? reasoningQuestion(difficulty)
          : factQuestion(difficulty);
    if (!recent.has(question.sourceKey) && (!contest || question.options.length === 4)) return question;
  }
  const fallback = freshMathQuestion(difficulty);
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
