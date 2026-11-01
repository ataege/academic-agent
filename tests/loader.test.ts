import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import {
  clearDataCache,
  findCourse,
  findStudent,
  getAvailableCourses,
  getCompletedEnrollments,
  getCoursesByDepartment,
  getCurrentEnrollments,
  getCurrentSemester,
  getDepartment,
  getStudentsByDepartment,
  hasPassedCourse,
  loadAcademicData,
} from "../src/data/loader.ts";
import {
  failedCourse,
  makeStudent,
  passedCourse,
  sampleData,
  sampleStudent,
} from "./helpers.ts";

const fixturePath = (fileName: string) =>
  new URL(`./fixtures/${fileName}`, import.meta.url).pathname;

const availableIds = (studentId: string) =>
  getAvailableCourses(sampleData, sampleStudent(studentId)).map(
    (course) => course.id,
  );

Deno.test("loadAcademicData loads the sample file from the default path", async () => {
  clearDataCache();
  const data = await loadAcademicData();

  assertEquals(data.students.length, 6);
  assertEquals(data.courses.length, 23);
  assertEquals(data.departments.length, 2);
});

Deno.test("loadAcademicData reuses the parsed data until the cache is cleared", async () => {
  clearDataCache();
  const firstLoad = await loadAcademicData();
  assertStrictEquals(await loadAcademicData(), firstLoad);

  clearDataCache();
  assertNotStrictEquals(await loadAcademicData(), firstLoad);
});

Deno.test("loadAcademicData reports a missing file by path", async () => {
  clearDataCache();
  await assertRejects(
    () => loadAcademicData("./tests/fixtures/does-not-exist.json"),
    Error,
    "does-not-exist.json",
  );
});

Deno.test("loadAcademicData rejects malformed JSON", async () => {
  clearDataCache();
  await assertRejects(
    () => loadAcademicData(fixturePath("malformed-data.txt")),
    SyntaxError,
  );
});

Deno.test("loadAcademicData rejects data missing a required section", async () => {
  clearDataCache();
  await assertRejects(
    () => loadAcademicData(fixturePath("missing-departments.json")),
    Error,
    "missing required fields",
  );
});

Deno.test("loadAcademicData doesn't cache a failed load", async () => {
  clearDataCache();
  await assertRejects(() =>
    loadAcademicData(fixturePath("missing-departments.json"))
  );

  assertEquals((await loadAcademicData()).students.length, 6);
});

Deno.test("findStudent matches an exact ID or part of a name", () => {
  assertEquals(findStudent(sampleData, "STU003")?.name, "David Wilson");
  assertEquals(findStudent(sampleData, "emily")?.id, "STU001");
  assertEquals(findStudent(sampleData, "WILSON")?.id, "STU003");
  assertEquals(findStudent(sampleData, "Nobody"), undefined);
});

Deno.test("findCourse matches an ID or a code with or without its space", () => {
  assertEquals(findCourse(sampleData, "CENG101")?.id, "CENG101");
  assertEquals(findCourse(sampleData, "CENG 101")?.id, "CENG101");
  assertEquals(findCourse(sampleData, "NOPE999"), undefined);
});

Deno.test("getDepartment finds a department by ID", () => {
  assertEquals(getDepartment(sampleData, "SENG")?.name, "Software Engineering");
  assertEquals(getDepartment(sampleData, "NOPE"), undefined);
});

Deno.test("getCurrentSemester finds the active semester", () => {
  assertEquals(getCurrentSemester(sampleData)?.id, "2024-FALL");
  assertEquals(
    getCurrentSemester({ ...sampleData, semesters: [] }),
    undefined,
  );
});

Deno.test("getStudentsByDepartment and getCoursesByDepartment filter by department", () => {
  assertEquals(
    getStudentsByDepartment(sampleData, "SENG").map((student) => student.id),
    ["STU004", "STU006"],
  );
  assertEquals(getCoursesByDepartment(sampleData, "SENG").length, 8);
  assertEquals(getCoursesByDepartment(sampleData, "NOPE"), []);
});

Deno.test("enrollment helpers separate current courses from completed ones", () => {
  // STU005 has 4 completed attempts and is retaking the failed MATH102
  const student = sampleStudent("STU005");

  assertEquals(
    getCurrentEnrollments(student).map((enrollment) => enrollment.course_id),
    ["MATH102", "CENG201", "MATH202"],
  );
  assertEquals(
    getCompletedEnrollments(student).map((enrollment) => enrollment.course_id),
    ["MATH101", "CENG101", "MATH102", "CENG102"],
  );
});

Deno.test("hasPassedCourse looks through retakes for a pass", () => {
  // STU003 failed MATH101 and then passed the retake
  assert(hasPassedCourse(sampleStudent("STU003"), "MATH101"));
  // STU005 failed MATH102 and is still retaking it
  assert(!hasPassedCourse(sampleStudent("STU005"), "MATH102"));
  assert(!hasPassedCourse(sampleStudent("STU005"), "CENG402"));
});

Deno.test("getAvailableCourses excludes passed, in-progress and locked courses", () => {
  // STU001 is taking CENG301, CENG302 and CENG350; CENG401 and CENG402 need them
  assertEquals(availableIds("STU001"), ["CENG360", "CENG370"]);
});

Deno.test("getAvailableCourses offers a failed course for retake", () => {
  const student = makeStudent({
    enrollments: [passedCourse("MATH101"), failedCourse("MATH102")],
  });

  assert(
    getAvailableCourses(sampleData, student).some((course) =>
      course.id === "MATH102"
    ),
  );
});

Deno.test("getAvailableCourses adds math courses for other departments", () => {
  assertEquals(availableIds("STU004"), ["MATH202", "SENG402"]);
  assertEquals(availableIds("STU006"), ["MATH202"]);
});

Deno.test("getAvailableCourses returns nothing for an unknown department", () => {
  assertEquals(
    getAvailableCourses(sampleData, makeStudent({ department_id: "NOPE" })),
    [],
  );
});

Deno.test("loadAcademicData doesn't serve one file's data for another path", async () => {
  clearDataCache();
  await loadAcademicData();

  const otherData = await loadAcademicData(fixturePath("empty-data.json"));

  assertEquals(otherData.students, []);
  clearDataCache();
});

Deno.test("findStudent doesn't match a blank search", () => {
  assertEquals(findStudent(sampleData, ""), undefined);
  assertEquals(findStudent(sampleData, "   "), undefined);
});
