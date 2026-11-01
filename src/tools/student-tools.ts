import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { AcademicData } from "../types/academic.ts";
import {
  findCourse,
  findStudent,
  getCurrentEnrollments,
} from "../data/loader.ts";
import { assessStudentRisk } from "../analysis/risk-assessment.ts";
import {
  calculateGraduationProgress,
  getGraduationTimeline,
  getRecommendedNextCourses,
} from "../analysis/graduation.ts";
import { predictFinalGrade } from "../analysis/gpa-calculator.ts";
import { getPersonalizedRecommendations } from "../rag/course-retriever.ts";

/**
 * Create student-specific tools bound to a specific student
 * These tools provide personalized academic information
 */
export function createStudentTools(data: AcademicData, studentId: string) {
  const student = findStudent(data, studentId);
  if (!student) {
    throw new Error(`Student not found: ${studentId}`);
  }

  // Tool 1: Get student profile and academic standing
  const getStudentProfile = tool(
    () => {
      const riskAssessment = assessStudentRisk(student, data);
      const department = data.departments.find(
        (d) => d.id === student.department_id,
      );

      return JSON.stringify({
        id: student.id,
        name: student.name,
        email: student.email,
        department: department?.name ?? student.department_id,
        enrollmentYear: student.enrollment_year,
        currentSemester: student.current_semester,
        gpa: student.gpa,
        completedCredits: student.completed_credits,
        status: student.status,
        riskLevel: riskAssessment.riskLevel,
        riskFactors: riskAssessment.factors,
        advisorNotes: student.advisor_notes,
      });
    },
    {
      name: "get_student_profile",
      description:
        "Get the student's academic profile including GPA, credits, status, and risk assessment. Use this to understand the student's current academic standing.",
    },
  );

  // Tool 2: Get current semester courses and grades
  const getCurrentCourses = tool(
    () => {
      const currentEnrollments = getCurrentEnrollments(student);

      const coursesWithDetails = currentEnrollments.map((enrollment) => {
        const course = findCourse(data, enrollment.course_id);
        return {
          courseCode: course?.code ?? enrollment.course_id,
          courseName: course?.name ?? "Unknown",
          credits: course?.credits ?? 0,
          midtermScore: enrollment.midterm_score,
          homeworkAvg: enrollment.homework_avg,
          projectScore: enrollment.project_score ?? null,
          attendance: enrollment.attendance,
        };
      });

      return JSON.stringify({
        semester: data.semesters.find((s) => s.is_current)?.name,
        courseCount: coursesWithDetails.length,
        courses: coursesWithDetails,
      });
    },
    {
      name: "get_current_courses",
      description:
        "Get all courses the student is currently enrolled in with their midterm scores, homework averages, and attendance. Use this to see current semester performance.",
    },
  );

  // Tool 3: Identify at-risk courses
  const getAtRiskCourses = tool(
    () => {
      const currentEnrollments = getCurrentEnrollments(student);

      const atRiskCourses = currentEnrollments
        .filter((e) => e.midterm_score !== null && e.midterm_score < 60)
        .map((enrollment) => {
          const course = findCourse(data, enrollment.course_id);

          // Calculate required final for CC (minimum passing)
          const prediction = predictFinalGrade(
            enrollment.midterm_score!,
            "CC",
            data.grade_weights,
            data.grading_scale,
          );

          return {
            courseCode: course?.code ?? enrollment.course_id,
            courseName: course?.name ?? "Unknown",
            midtermScore: enrollment.midterm_score,
            requiredFinalForPass: prediction.requiredFinal,
            passingAchievable: prediction.achievable,
            recommendation: prediction.achievable
              ? `Need ${prediction.requiredFinal}% on final to pass with CC`
              : "Focus on other courses; may need to retake this course",
          };
        });

      return JSON.stringify({
        atRiskCount: atRiskCourses.length,
        courses: atRiskCourses,
        summary: atRiskCourses.length === 0
          ? "No courses currently at risk of failing"
          : `${atRiskCourses.length} course(s) need immediate attention`,
      });
    },
    {
      name: "get_at_risk_courses",
      description:
        "Identify courses where the student is at risk of failing based on midterm scores. Shows required final exam score to pass and whether passing is achievable.",
    },
  );

  // Tool 4: Get graduation progress
  const getGraduationProgress = tool(
    () => {
      const progress = calculateGraduationProgress(student, data);
      const timeline = getGraduationTimeline(student, data);

      return JSON.stringify({
        department: progress.department,
        creditsCompleted: progress.completedCredits,
        creditsRequired: progress.requiredCredits,
        creditsRemaining: progress.creditsRemaining,
        requiredCoursesCompleted: progress.completedRequired.length,
        requiredCoursesRemaining: progress.remainingRequired.length,
        remainingRequiredCourses: progress.remainingRequired.map((id) => {
          const course = findCourse(data, id);
          return course?.name ?? id;
        }),
        electiveCredits: progress.electiveCredits,
        electiveCreditsNeeded: progress.electiveCreditsNeeded,
        gpaStatus: progress.gpaStatus,
        isOnTrack: progress.isOnTrack,
        estimatedGraduation: timeline.estimatedGraduation,
        semestersRemaining: timeline.semestersRemaining,
        riskFactors: timeline.riskFactors,
      });
    },
    {
      name: "get_graduation_progress",
      description:
        "Get detailed graduation progress including remaining requirements, credits needed, estimated graduation date, and whether the student is on track.",
    },
  );

  // Tool 5: Get course history
  const getCourseHistory = tool(
    () => {
      const completedEnrollments = student.enrollments.filter(
        (e) => e.status !== "in_progress",
      );

      // Group by semester
      const bySemester: Record<
        string,
        {
          courseCode: string;
          courseName: string;
          grade: string | null;
          score: number | null;
          status: string;
          credits: number;
        }[]
      > = {};
      for (const enrollment of completedEnrollments) {
        const semesterName = data.semesters.find((s) =>
          s.id === enrollment.semester_id
        )?.name ??
          enrollment.semester_id;
        const course = findCourse(data, enrollment.course_id);

        if (!bySemester[semesterName]) {
          bySemester[semesterName] = [];
        }
        bySemester[semesterName].push({
          courseCode: course?.code ?? enrollment.course_id,
          courseName: course?.name ?? "Unknown",
          grade: enrollment.letter_grade,
          score: enrollment.weighted_average,
          status: enrollment.status,
          credits: course?.credits ?? 0,
        });
      }

      return JSON.stringify({
        totalCoursesCompleted: completedEnrollments.length,
        passedCourses: completedEnrollments.filter((e) => e.status === "passed")
          .length,
        failedCourses: completedEnrollments.filter((e) => e.status === "failed")
          .length,
        history: bySemester,
      });
    },
    {
      name: "get_course_history",
      description:
        "Get complete course history organized by semester, showing grades, scores, and pass/fail status for all completed courses.",
    },
  );

  // Tool 6: Get personalized recommendations
  const getRecommendations = tool(
    () => {
      const riskAssessment = assessStudentRisk(student, data);
      const graduationProgress = calculateGraduationProgress(student, data);
      const nextCourses = getRecommendedNextCourses(student, data, 4);

      // Build recommendations based on situation
      const immediateActions: string[] = [...riskAssessment.recommendations];

      // GPA-based recommendations
      if (student.gpa < 2.0) {
        immediateActions.push(
          "Priority: Raise GPA above 2.0 to meet graduation requirements",
        );
        immediateActions.push("Consider reduced course load next semester");
      } else if (student.gpa < 2.5) {
        immediateActions.push("Focus on improving grades in core courses");
        immediateActions.push("Utilize tutoring and study groups");
      } else if (student.gpa >= 3.5) {
        immediateActions.push(
          "Consider graduate school preparation or research opportunities",
        );
        immediateActions.push(
          "Explore challenging electives to broaden skills",
        );
      }

      // Course recommendations
      const nextSemesterSuggestions = nextCourses.map((course) => ({
        courseCode: course.code,
        courseName: course.name,
        credits: course.credits,
        type: course.type,
        reason: graduationProgress.remainingRequired.includes(course.id)
          ? "Required for graduation"
          : "Elective - builds on your completed courses",
      }));

      return JSON.stringify({
        riskLevel: riskAssessment.riskLevel,
        immediateActions,
        nextSemesterCourses: nextSemesterSuggestions,
        graduationPriorities: graduationProgress.remainingRequired
          .slice(0, 3)
          .map((id) => findCourse(data, id)?.name ?? id),
      });
    },
    {
      name: "get_recommendations",
      description:
        "Get personalized recommendations including immediate actions, next semester course suggestions, and graduation priorities based on current academic standing.",
    },
  );

  // Tool 7: Search courses by topic (RAG)
  const searchCoursesByTopic = tool(
    async ({ query }) => {
      const results = await getPersonalizedRecommendations(
        query,
        student.id,
        data,
        3,
      );

      return JSON.stringify({
        query,
        matchingCourses: results.recommended.map((course) => ({
          courseCode: course.code,
          courseName: course.name,
          description: course.description,
          credits: course.credits,
          type: course.type,
        })),
        reasoning: results.reasoning,
      });
    },
    {
      name: "search_courses_by_topic",
      description:
        "Search for courses by topic, interest, or skill using semantic search. Returns courses the student can take (prerequisites met, not already completed). Use this when the student asks about specific topics like 'AI', 'web development', 'databases'.",
      schema: z.object({
        query: z
          .string()
          .describe(
            "The topic, skill, or interest to search for (e.g., 'machine learning', 'web development')",
          ),
      }),
    },
  );

  return [
    getStudentProfile,
    getCurrentCourses,
    getAtRiskCourses,
    getGraduationProgress,
    getCourseHistory,
    getRecommendations,
    searchCoursesByTopic,
  ];
}
