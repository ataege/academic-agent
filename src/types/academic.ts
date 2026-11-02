// Grade scale entry for letter grade to GPA mapping
export interface GradeScaleEntry {
  min: number; // Minimum score for this grade
  max: number; // Maximum score for this grade
  gpa: number; // GPA value (4.0 scale)
}

// Grade weights for weighted average calculation
export interface GradeWeights {
  midterm: number; // 0.4 (40%)
  final: number; // 0.6 (60%)
}

// Semester definition
export interface Semester {
  id: string; // e.g., "2024-FALL"
  name: string; // e.g., "2024-2025 Fall"
  start_date: string; // ISO date string
  end_date: string; // ISO date string
  is_current: boolean; // Whether this is the active semester
}

// Graduation requirements for a department
export interface GraduationRequirements {
  min_credits: number; // Total credits needed (e.g., 140)
  min_gpa: number; // Minimum GPA required (e.g., 2.0)
  required_courses: string[]; // Course IDs that must be completed
  min_elective_credits: number; // Minimum elective credits (e.g., 18)
}

// Academic department
export interface Department {
  id: string; // "CENG" or "SENG"
  name: string; // Full department name
  head: string; // Department head name
  graduation_requirements: GraduationRequirements;
}

// Course definition
export interface Course {
  id: string; // Course ID (e.g., "CENG101")
  code: string; // Display code (e.g., "CENG 101")
  name: string; // Course name
  department_id: string; // Owning department
  credits: number; // Credit hours
  semester: number; // Recommended semester (1-8)
  type: "required" | "elective";
  prerequisites: string[]; // Course IDs required before taking
  description: string; // Course description
}

// Student enrollment in a course
export interface Enrollment {
  course_id: string; // Course being taken
  semester_id: string; // When the course was taken
  midterm_score: number | null; // Midterm exam score (null if not graded)
  final_score: number | null; // Final exam score (null if not graded)
  homework_avg: number; // Average homework score
  project_score?: number | null; // Project score (optional, some courses)
  attendance: number; // Attendance percentage
  weighted_average: number | null; // Calculated weighted average
  letter_grade: string | null; // Final letter grade
  status: "passed" | "failed" | "in_progress";
}

// Student record
export interface Student {
  id: string; // Student ID (e.g., "STU001")
  name: string; // Full name
  email: string; // University email
  department_id: string; // Department the student belongs to
  enrollment_year: number; // Year enrolled (e.g., 2022)
  current_semester: number; // Current academic semester (1-8)
  status: "active" | "probation" | "warning";
  gpa: number; // Cumulative GPA
  completed_credits: number; // Total completed credits
  advisor_notes: string; // Notes from academic advisor
  enrollments: Enrollment[]; // All course enrollments
}

// University metadata
export interface University {
  name: string; // University name
  code: string; // Short code
  academic_year: string; // Current academic year
}

// Root data structure matching academic_data.json
export interface AcademicData {
  university: University;
  grading_scale: Record<string, GradeScaleEntry>; // Letter grade -> scale entry
  grade_weights: GradeWeights;
  semesters: Semester[];
  departments: Department[];
  courses: Course[];
  students: Student[];
}

// Risk assessment result
export interface RiskAssessment {
  studentId: string;
  studentName: string;
  riskLevel: "critical" | "warning" | "normal";
  factors: string[]; // List of risk factors identified
  recommendations: string[]; // Suggested actions
}

// Graduation progress tracking
export interface GraduationProgress {
  studentId: string;
  department: string;
  completedCredits: number;
  requiredCredits: number;
  creditsRemaining: number;
  completedRequired: string[]; // Required courses completed
  remainingRequired: string[]; // Required courses still needed
  electiveCredits: number;
  electiveCreditsNeeded: number;
  gpaStatus: "meets" | "below"; // Whether GPA meets graduation requirement
  estimatedSemesters: number; // Estimated semesters to graduate
  isOnTrack: boolean; // Whether progress is on schedule
}

// Department statistics
export interface DepartmentStats {
  departmentId: string;
  departmentName: string;
  totalStudents: number;
  averageGPA: number;
  atRiskCount: number; // Students with GPA < 2.0 or warning status
  probationCount: number; // Students on probation
  courseStats: CourseStats[];
}

// Course performance statistics
export interface CourseStats {
  courseId: string;
  courseName: string;
  totalEnrollments: number;
  passRate: number; // Percentage
  failRate: number; // Percentage
  averageScore: number;
  atRiskCount: number; // Currently enrolled students at risk
}
