const test = require("node:test");
const assert = require("node:assert/strict");
const { roomPoints, contestPoints } = require("../services/quizService");
const { FACTS, answerMatches, generateQuestion, generateContestSet, publicQuestion } = require("../services/quizQuestionEngine");

test("Quiz Room gives 100 points for three seconds, then decays without dropping below sixty", () => {
  assert.equal(roomPoints(0), 100);
  assert.equal(roomPoints(2999), 100);
  assert.equal(roomPoints(3000), 100);
  assert.equal(roomPoints(3001), 90);
  assert.equal(roomPoints(10999), 60);
  assert.equal(roomPoints(60000), 60);
});

test("contest scoring decays by two per whole second and never drops below two", () => {
  assert.equal(contestPoints(0), 20);
  assert.equal(contestPoints(999), 20);
  assert.equal(contestPoints(1000), 18);
  assert.equal(contestPoints(10000), 2);
  assert.equal(contestPoints(60000), 2);
});

test("typed answers are normalized but must respect their declared format", () => {
  const number = { answerType: "number", acceptedAnswers: ["206"] };
  const phrase = { answerType: "phrase", acceptedAnswers: ["South America"] };
  const numberedPhrase = { answerType: "phrase", acceptedAnswers: ["Apollo 11"] };
  const boolean = { answerType: "boolean", acceptedAnswers: ["True"] };
  assert.equal(answerMatches(number, " 206 "), true);
  assert.equal(answerMatches(number, "two hundred six"), false);
  assert.equal(answerMatches(phrase, "south   america"), true);
  assert.equal(answerMatches(numberedPhrase, "Apollo 11"), true);
  assert.equal(answerMatches(boolean, "TRUE"), true);
  assert.equal(answerMatches(boolean, "yes"), false);
});

test("public questions never reveal private answers", () => {
  const generated = generateQuestion({});
  const visible = publicQuestion(generated);
  assert.equal(Object.hasOwn(visible, "answer"), false);
  assert.equal(Object.hasOwn(visible, "acceptedAnswers"), false);
  assert.equal(Object.hasOwn(visible, "correctOption"), false);
});

test("a contest set has twenty unique four-option questions", () => {
  const questions = generateContestSet(20);
  assert.equal(questions.length, 20);
  assert.equal(new Set(questions.map((item) => item.sourceKey)).size, 20);
  questions.forEach((question) => {
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options.map((item) => String(item).toLowerCase())).size, 4);
    assert.ok(question.correctOption >= 0 && question.correctOption < 4);
  });
});

test("generated questions keep the requested 50/30/20 difficulty balance", () => {
  const questions = Array.from({ length: 100 }, () => generateQuestion({}));
  const counts = questions.reduce((result, question) => {
    result[question.difficulty] = Number(result[question.difficulty] || 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, { easy: 50, moderate: 30, difficult: 20 });
});

test("the procedural pool can serve a thousand fresh questions without repeats", () => {
  const questions = [];
  const recentKeys = [];
  for (let index = 0; index < 1000; index += 1) {
    const question = generateQuestion({ contest: true, recentKeys });
    questions.push(question);
    recentKeys.push(question.sourceKey);
  }
  assert.equal(new Set(recentKeys).size, 1000);
  const mathsAndScience = questions.filter((question) => ["Mathematics", "Algebra", "Geometry", "Physics", "Chemistry", "Space Science", "Science"].includes(question.category));
  assert.ok(mathsAndScience.length >= 750);
});

test("the question bank has broad science, reasoning, and general knowledge coverage", () => {
  const counts = FACTS.reduce((result, [category]) => {
    result[category] = Number(result[category] || 0) + 1;
    return result;
  }, {});
  ["Space Science", "Chemistry", "Physics", "Logical Reasoning", "General Knowledge"].forEach((category) => {
    assert.ok(counts[category] >= 15, `${category} should have at least fifteen questions`);
  });
  assert.ok(FACTS.length >= 100);
});
