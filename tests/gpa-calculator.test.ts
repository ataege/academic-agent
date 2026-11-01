import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  calculateGPA,
  calculateRequiredScores,
  calculateWeightedAverage,
  getGPAForGrade,
  getLetterGrade,
  predictFinalGrade,
  projectSemesterGPA,
} from "../src/analysis/gpa-calculator.ts";
import {
  makeEnrollment,
  passedCourse,
  sampleData,
  sampleStudent,
} from "./helpers.ts";

const {
  courses,
  grade_weights: gradeWeights,
  grading_scale: gradingScale,
} = sampleData;

Deno.test("calculateWeightedAverage weights the final more than the midterm", () => {
  assertEquals(calculateWeightedAverage(50, 100, gradeWeights), 80);
  assertEquals(calculateWeightedAverage(100, 50, gradeWeights), 70);
});

Deno.test("calculateWeightedAverage reproduces the stored sample averages", () => {
  const completed = sampleData.students
    .flatMap((student) => student.enrollments)
    .filter((enrollment) => enrollment.status !== "in_progress");

  for (const enrollment of completed) {
    assertAlmostEquals(
      calculateWeightedAverage(
        enrollment.midterm_score!,
        enrollment.final_score!,
        gradeWeights,
      ),
      enrollment.weighted_average!,
      0.051, // Stored averages are rounded to one decimal
    );
  }
});

Deno.test("getLetterGrade picks the bracket at each boundary", () => {
  const expectedGrades: [number, string][] = [
    [100, "AA"],
    [90, "AA"],
    [89, "BA"],
    [85, "BA"],
    [84, "BB"],
    [60, "DD"],
    [59, "FD"],
    [50, "FD"],
    [49, "FF"],
    [0, "FF"],
    [-1, "FF"],
  ];

  for (const [score, grade] of expectedGrades) {
    assertEquals(getLetterGrade(score, gradingScale), grade, `score ${score}`);
  }
});

Deno.test("getGPAForGrade returns scale points and 0 for an unknown grade", () => {
  assertEquals(getGPAForGrade("AA", gradingScale), 4);
  assertEquals(getGPAForGrade("DC", gradingScale), 1.5);
  assertEquals(getGPAForGrade("ZZ", gradingScale), 0);
});

Deno.test("calculateGPA returns 0 with no completed courses", () => {
  assertEquals(calculateGPA([], courses, gradingScale), 0);
  assertEquals(
    calculateGPA(
      [makeEnrollment({ midterm_score: 90 })],
      courses,
      gradingScale,
    ),
    0,
  );
});

Deno.test("calculateGPA weights grades by course credits", () => {
  const enrollments = [
    passedCourse("MATH101", "AA"), // 4 credits at 4.0
    passedCourse("CENG350", "CC"), // 3 credits at 2.0
  ];

  assertAlmostEquals(
    calculateGPA(enrollments, courses, gradingScale),
    22 / 7,
    1e-9,
  );
});

Deno.test("calculateGPA skips unknown courses and unknown grades", () => {
  const enrollments = [
    passedCourse("MATH101", "BB"),
    passedCourse("NOPE999", "AA"),
    passedCourse("CENG101", "ZZ"),
  ];

  assertEquals(calculateGPA(enrollments, courses, gradingScale), 3);
});

Deno.test("predictFinalGrade works out the final score a target needs", () => {
  const expectedResults: [number, string, number, boolean][] = [
    [50, "CC", 84, true],
    [51, "CC", 83, true], // 82.67 rounds up
    [100, "AA", 84, true],
    [24, "CC", 101, false], // Just out of reach
    [0, "AA", 150, false],
  ];

  for (const [midterm, target, requiredFinal, achievable] of expectedResults) {
    const prediction = predictFinalGrade(
      midterm,
      target,
      gradeWeights,
      gradingScale,
    );
    assertEquals(
      prediction.requiredFinal,
      requiredFinal,
      `${midterm} ${target}`,
    );
    assertEquals(prediction.achievable, achievable, `${midterm} ${target}`);
  }
});

Deno.test("predictFinalGrade rejects an unknown target grade", () => {
  const prediction = predictFinalGrade(
    90,
    "ZZ",
    gradeWeights,
    gradingScale,
  );

  assertEquals(prediction.achievable, false);
  assertEquals(prediction.requiredFinal, 0);
});

Deno.test("projectSemesterGPA is null without a graded course in progress", () => {
  assertEquals(
    projectSemesterGPA(
      [passedCourse("MATH101")],
      courses,
      gradingScale,
      gradeWeights,
    ),
    null,
  );
  assertEquals(
    projectSemesterGPA([makeEnrollment()], courses, gradingScale, gradeWeights),
    null,
  );
});

Deno.test("projectSemesterGPA projects each midterm onto the final", () => {
  const projectedGPA = (studentId: string) =>
    projectSemesterGPA(
      sampleStudent(studentId).enrollments,
      courses,
      gradingScale,
      gradeWeights,
    )!;

  // SENG401 midterm 86 is a BA
  assertEquals(projectedGPA("STU004"), 3.5);
  // MATH201 midterm 48 is FF, MATH202 midterm 55 is FD, 3 credits each
  assertEquals(projectedGPA("STU003"), 0.25);
  // 4 credits at BA, 4 credits at BA, 3 credits at AA
  assertAlmostEquals(projectedGPA("STU001"), 40 / 11, 1e-9);
});

Deno.test("calculateRequiredScores uses the lowest grade reaching the target GPA", () => {
  // CENG301 midterm 70 and CENG360 midterm 78, with a 3.0 target meaning BB
  assertEquals(
    calculateRequiredScores(
      sampleStudent("STU002").enrollments,
      courses,
      3.0,
      gradingScale,
      gradeWeights,
    ),
    [
      { courseId: "CENG301", requiredFinal: 87, achievable: true },
      { courseId: "CENG360", requiredFinal: 82, achievable: true },
    ],
  );
});

Deno.test("calculateRequiredScores ignores completed and ungraded courses", () => {
  const enrollments = [passedCourse("MATH101"), makeEnrollment()];

  assertEquals(
    calculateRequiredScores(
      enrollments,
      courses,
      2.0,
      gradingScale,
      gradeWeights,
    ),
    [],
  );
});

Deno.test("getLetterGrade keeps fractional scores in the bracket below", () => {
  const expectedGrades: [number, string][] = [
    [89.4, "BA"],
    [89.99, "BA"],
    [84.5, "BB"],
    [79.5, "CB"],
    [74.5, "CC"],
    [69.5, "DC"],
    [64.5, "DD"],
    [59.5, "FD"],
    [49.5, "FF"],
  ];

  for (const [score, grade] of expectedGrades) {
    assertEquals(getLetterGrade(score, gradingScale), grade, `score ${score}`);
  }
});

Deno.test("getLetterGrade agrees with every stored sample grade", () => {
  const completed = sampleData.students
    .flatMap((student) => student.enrollments)
    .filter((enrollment) => enrollment.status !== "in_progress");

  for (const enrollment of completed) {
    assertEquals(
      getLetterGrade(enrollment.weighted_average!, gradingScale),
      enrollment.letter_grade,
      `average ${enrollment.weighted_average}`,
    );
  }
});

Deno.test("predictFinalGrade isn't pushed up a point by float noise", () => {
  // Each pair lands exactly on the target: 0.4 * 52 + 0.6 * 82 = 70
  const exactFinals: [number, number][] = [[52, 82], [67, 72], [91, 56]];

  for (const [midterm, requiredFinal] of exactFinals) {
    assertEquals(
      predictFinalGrade(midterm, "CC", gradeWeights, gradingScale)
        .requiredFinal,
      requiredFinal,
      `midterm ${midterm}`,
    );
  }
});

Deno.test("predictFinalGrade treats a grade already secured as achievable", () => {
  const prediction = predictFinalGrade(
    100,
    "FF",
    gradeWeights,
    gradingScale,
  );

  assertEquals(prediction.achievable, true);
  assertEquals(prediction.requiredFinal, 0);
});
