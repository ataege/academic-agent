import type { AcademicData, Student, Course, Department, Semester } from "../types/academic.ts";

// Default path to academic data file
const DEFAULT_DATA_PATH = "./data/academic_data.json";

// Cached data to avoid repeated file reads
let cachedData: AcademicData | null = null;

/**
 * Load and parse academic data from JSON file
 * Uses caching to avoid repeated file reads
 */
export async function loadAcademicData(
  path: string = DEFAULT_DATA_PATH
): Promise<AcademicData> {
  // Return cached data if available
  if (cachedData) {
    return cachedData;
  }

  try {
    const rawData = await Deno.readTextFile(path);
    const data: AcademicData = JSON.parse(rawData);

    // Validate essential data exists
    if (!data.students || !data.courses || !data.departments) {
      throw new Error("Invalid academic data structure: missing required fields");
    }

    // Cache for future use
    cachedData = data;
    return data;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Academic data file not found: ${path}`);
    }
    throw error;
  }
}

/**
 * Clear cached data (useful for testing or data refresh)
 */
export function clearDataCache(): void {
  cachedData = null;
}

/**
 * Find student by ID or partial name match
 */
export function findStudent(
  data: AcademicData,
  identifier: string
): Student | undefined {
  // First try exact ID match
  const byId = data.students.find((s) => s.id === identifier);
  if (byId) return byId;

  // Then try partial name match (case-insensitive)
  return data.students.find((s) =>
    s.name.toLowerCase().includes(identifier.toLowerCase())
  );
}

/**
 * Find course by ID or course code
 */
export function findCourse(
  data: AcademicData,
  identifier: string
): Course | undefined {
  return data.courses.find(
    (c) =>
      c.id === identifier ||
      c.code === identifier ||
      c.code.replace(" ", "") === identifier // Handle "CENG101" vs "CENG 101"
  );
}

/**
 * Get department by ID
 */
export function getDepartment(
  data: AcademicData,
  departmentId: string
): Department | undefined {
  return data.departments.find((d) => d.id === departmentId);
}

/**
 * Get the current active semester
 */
export function getCurrentSemester(data: AcademicData): Semester | undefined {
  return data.semesters.find((s) => s.is_current);
}

/**
 * Get all students in a department
 */
export function getStudentsByDepartment(
  data: AcademicData,
  departmentId: string
): Student[] {
  return data.students.filter((s) => s.department_id === departmentId);
}

/**
 * Get all courses for a department
 */
export function getCoursesByDepartment(
  data: AcademicData,
  departmentId: string
): Course[] {
  return data.courses.filter((c) => c.department_id === departmentId);
}

/**
 * Get student's current semester enrollments (in_progress status)
 */
export function getCurrentEnrollments(student: Student) {
  return student.enrollments.filter((e) => e.status === "in_progress");
}

/**
 * Get student's completed enrollments (passed or failed)
 */
export function getCompletedEnrollments(student: Student) {
  return student.enrollments.filter((e) => e.status !== "in_progress");
}

/**
 * Check if a student has passed a specific course
 */
export function hasPassedCourse(student: Student, courseId: string): boolean {
  return student.enrollments.some(
    (e) => e.course_id === courseId && e.status === "passed"
  );
}

/**
 * Get courses available for a student (prerequisites met, not already passed)
 */
export function getAvailableCourses(
  data: AcademicData,
  student: Student
): Course[] {
  const department = getDepartment(data, student.department_id);
  if (!department) return [];

  // Get all department courses plus math courses
  const relevantCourses = data.courses.filter(
    (c) =>
      c.department_id === student.department_id ||
      c.id.startsWith("MATH")
  );

  return relevantCourses.filter((course) => {
    // Skip if already passed
    if (hasPassedCourse(student, course.id)) return false;

    // Skip if currently enrolled
    const currentlyEnrolled = student.enrollments.some(
      (e) => e.course_id === course.id && e.status === "in_progress"
    );
    if (currentlyEnrolled) return false;

    // Check prerequisites are met
    const prerequisitesMet = course.prerequisites.every((prereq) =>
      hasPassedCourse(student, prereq)
    );
    return prerequisitesMet;
  });
}
