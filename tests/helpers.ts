import type {
  AcademicData,
  Enrollment,
  Student,
} from "../src/types/academic.ts";

// Parsed directly so analysis tests don't depend on the loader's cache
export const sampleData: AcademicData = JSON.parse(
  await Deno.readTextFile(
    new URL("../data/academic_data.json", import.meta.url),
  ),
);

export function sampleStudent(studentId: string): Student {
  const student = sampleData.students.find((s) => s.id === studentId);
  if (!student) throw new Error(`No sample student: ${studentId}`);
  return student;
}

// Sample catalogue and rules with a custom set of students
export function dataWithStudents(...students: Student[]): AcademicData {
  return { ...sampleData, students };
}

export function makeEnrollment(
  overrides: Partial<Enrollment> = {},
): Enrollment {
  return {
    course_id: "CENG101",
    semester_id: "2024-FALL",
    midterm_score: null,
    final_score: null,
    homework_avg: 0,
    attendance: 100,
    weighted_average: null,
    letter_grade: null,
    status: "in_progress",
    ...overrides,
  };
}

// First-semester CENG student in good standing with no course history
export function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "TEST001",
    name: "Test Student",
    email: "test.student@tu.edu",
    department_id: "CENG",
    enrollment_year: 2024,
    current_semester: 1,
    status: "active",
    gpa: 3.0,
    completed_credits: 0,
    advisor_notes: "",
    enrollments: [],
    ...overrides,
  };
}

export function passedCourse(courseId: string, letterGrade = "CC"): Enrollment {
  return makeEnrollment({
    course_id: courseId,
    letter_grade: letterGrade,
    status: "passed",
  });
}

export function failedCourse(courseId: string): Enrollment {
  return makeEnrollment({
    course_id: courseId,
    letter_grade: "FF",
    status: "failed",
  });
}
