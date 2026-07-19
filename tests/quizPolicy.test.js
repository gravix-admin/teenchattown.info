const test = require("node:test");
const assert = require("node:assert/strict");
const { roomPoints, contestPoints } = require("../services/quizService");
const { answerMatches, generateQuestion, generateContestSet, publicQuestion } = require("../services/quizQuestionEngine");

test("Quiz Room points decay every two seconds and never drop below sixty", () => {
  assert.equal(roomPoints(0), 100);
  assert.equal(roomPoints(1999), 100);
  assert.equal(roomPoints(2000), 90);
  assert.equal(roomPoints(9999), 60);
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
  const boolean = { answerType: "boolean", acceptedAnswers: ["True"] };
  assert.equal(answerMatches(number, " 206 "), true);
  assert.equal(answerMatches(number, "two hundred six"), false);
  assert.equal(answerMatches(phrase, "south   america"), true);
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
