import * as z from "zod/v4";

// MCP input and output schemas for the LangChain tools in src/tools.
// Outputs are strict, so a field added to a tool without updating its schema fails the tests.

const riskLevel = z.enum(["critical", "warning", "normal"]);
const noInput = z.object({});

export interface ToolSchemas {
  input: z.ZodObject;
  output: z.ZodObject;
}

export const STUDENT_TOOL_SCHEMAS: Record<string, ToolSchemas> = {
  get_student_profile: {
    input: noInput,
    output: z.strictObject({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      department: z.string(),
      enrollmentYear: z.number(),
      currentSemester: z.number(),
      gpa: z.number(),
      completedCredits: z.number(),
      status: z.string(),
      riskLevel,
      riskFactors: z.array(z.string()),
      advisorNotes: z.string(),
    }),
  },
  get_current_courses: {
    input: noInput,
    output: z.strictObject({
      semester: z.string().optional(),
      courseCount: z.number(),
      courses: z.array(z.strictObject({
        courseCode: z.string(),
        courseName: z.string(),
        credits: z.number(),
        midtermScore: z.number().nullable(),
        homeworkAvg: z.number(),
        projectScore: z.number().nullable(),
        attendance: z.number(),
      })),
    }),
  },
  get_at_risk_courses: {
    input: noInput,
    output: z.strictObject({
      atRiskCount: z.number(),
      courses: z.array(z.strictObject({
        courseCode: z.string(),
        courseName: z.string(),
        midtermScore: z.number(),
        requiredFinalForPass: z.number(),
        passingAchievable: z.boolean(),
        recommendation: z.string(),
      })),
      summary: z.string(),
    }),
  },
  get_graduation_progress: {
    input: noInput,
    output: z.strictObject({
      department: z.string(),
      creditsCompleted: z.number(),
      creditsRequired: z.number(),
      creditsRemaining: z.number(),
      requiredCoursesCompleted: z.number(),
      requiredCoursesRemaining: z.number(),
      remainingRequiredCourses: z.array(z.string()),
      electiveCredits: z.number(),
      electiveCreditsNeeded: z.number(),
      gpaStatus: z.enum(["meets", "below"]),
      isOnTrack: z.boolean(),
      estimatedGraduation: z.string(),
      semestersRemaining: z.number(),
      riskFactors: z.array(z.string()),
    }),
  },
  get_course_history: {
    input: noInput,
    output: z.strictObject({
      totalCoursesCompleted: z.number(),
      passedCourses: z.number(),
      failedCourses: z.number(),
      // Keyed by semester name
      history: z.record(
        z.string(),
        z.array(z.strictObject({
          courseCode: z.string(),
          courseName: z.string(),
          grade: z.string().nullable(),
          score: z.number().nullable(),
          status: z.string(),
          credits: z.number(),
        })),
      ),
    }),
  },
  get_recommendations: {
    input: noInput,
    output: z.strictObject({
      riskLevel,
      immediateActions: z.array(z.string()),
      nextSemesterCourses: z.array(z.strictObject({
        courseCode: z.string(),
        courseName: z.string(),
        credits: z.number(),
        type: z.string(),
        reason: z.string(),
      })),
      graduationPriorities: z.array(z.string()),
    }),
  },
  search_courses_by_topic: {
    input: z.object({
      query: z.string().trim().min(1).max(200).describe(
        "The topic, skill, or interest to search for (e.g., 'machine learning', 'web development')",
      ),
    }),
    output: z.strictObject({
      query: z.string(),
      matchingCourses: z.array(z.strictObject({
        courseCode: z.string(),
        courseName: z.string(),
        description: z.string(),
        credits: z.number(),
        type: z.string(),
      })),
      reasoning: z.array(z.string()),
    }),
  },
};

export const DEAN_TOOL_SCHEMAS: Record<string, ToolSchemas> = {
  get_all_at_risk_students: {
    input: noInput,
    output: z.strictObject({
      summary: z.strictObject({
        totalStudents: z.number(),
        criticalCount: z.number(),
        warningCount: z.number(),
        normalCount: z.number(),
        byDepartment: z.record(
          z.string(),
          z.strictObject({ critical: z.number(), warning: z.number() }),
        ),
      }),
      students: z.array(z.strictObject({
        studentId: z.string(),
        name: z.string(),
        department: z.string().optional(),
        gpa: z.number().optional(),
        riskLevel,
        factors: z.array(z.string()),
        recommendations: z.array(z.string()),
      })),
    }),
  },
  get_department_statistics: {
    input: z.object({
      departmentId: z.enum(["CENG", "SENG"]).describe(
        "Department ID: CENG (Computer Engineering) or SENG (Software Engineering)",
      ),
    }),
    output: z.strictObject({
      departmentId: z.string(),
      departmentName: z.string(),
      totalStudents: z.number(),
      averageGPA: z.string(),
      atRiskStudents: z.number(),
      studentsOnProbation: z.number(),
      // A formatted percentage, or 0 for a department with no students
      atRiskPercentage: z.union([z.string(), z.number()]),
      coursePerformance: z.array(z.strictObject({
        courseId: z.string(),
        courseName: z.string(),
        passRate: z.string(),
        failRate: z.string(),
        averageScore: z.string(),
        currentlyAtRisk: z.number(),
      })),
    }),
  },
  get_institution_overview: {
    input: noInput,
    output: z.strictObject({
      university: z.string(),
      academicYear: z.string(),
      currentSemester: z.string(),
      totalStudents: z.number(),
      averageGPA: z.string(),
      statusDistribution: z.strictObject({
        active: z.number(),
        warning: z.number(),
        probation: z.number(),
      }),
      departments: z.array(z.strictObject({
        id: z.string(),
        name: z.string(),
        studentCount: z.number(),
        avgGPA: z.string(),
      })),
      departmentComparison: z.strictObject({
        bestPerforming: z.string(),
        needsAttention: z.string(),
      }),
    }),
  },
  get_course_performance_report: {
    input: z.object({
      courseId: z.string().trim().min(1).max(20).describe(
        "Course ID or code (e.g., 'CENG101', 'MATH201', 'SENG202')",
      ),
    }),
    output: z.strictObject({
      courseId: z.string(),
      courseCode: z.string(),
      courseName: z.string(),
      credits: z.number(),
      department: z.string(),
      type: z.string(),
      historicalData: z.strictObject({
        totalEnrollments: z.number(),
        passRate: z.string(),
        failRate: z.string(),
        averageScore: z.string(),
        gradeDistribution: z.record(z.string(), z.number()),
      }),
      currentSemester: z.strictObject({
        enrolled: z.number(),
        atRiskCount: z.number(),
        atRiskStudents: z.array(z.strictObject({
          studentId: z.string().optional(),
          studentName: z.string().optional(),
          midtermScore: z.number(),
        })),
      }),
    }),
  },
  get_student_details: {
    input: z.object({
      studentId: z.string().trim().min(1).max(100).describe(
        "Student ID (e.g., 'STU001') or partial name (e.g., 'Emily')",
      ),
    }),
    output: z.strictObject({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      department: z.string(),
      enrollmentYear: z.number(),
      currentSemester: z.number(),
      status: z.string(),
      gpa: z.number(),
      completedCredits: z.number(),
      advisorNotes: z.string(),
      currentCourses: z.array(z.strictObject({
        courseCode: z.string().optional(),
        courseName: z.string().optional(),
        midterm: z.number().nullable(),
        homework: z.number(),
        attendance: z.number(),
      })),
      failedCoursesHistory: z.array(z.strictObject({
        courseCode: z.string().optional(),
        semester: z.string(),
        score: z.number().nullable(),
      })),
    }),
  },
  get_intervention_recommendations: {
    input: noInput,
    output: z.strictObject({
      summary: z.strictObject({
        totalAtRisk: z.number(),
        criticalCount: z.number(),
        warningCount: z.number(),
        problemCoursesCount: z.number(),
      }),
      immediateStudentInterventions: z.array(z.strictObject({
        studentId: z.string(),
        studentName: z.string(),
        department: z.string().optional(),
        gpa: z.number().optional(),
        status: z.string().optional(),
        requiredActions: z.array(z.string()),
      })),
      courseInterventions: z.array(z.strictObject({
        courseId: z.string(),
        courseName: z.string(),
        failRate: z.string(),
        recommendation: z.string(),
      })),
      institutionalRecommendations: z.array(z.string()),
      priorityActions: z.array(z.string()),
    }),
  },
};
