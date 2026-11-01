import { type AgentConfig, createAgent } from "./base-agent.ts";
import { createStudentTools } from "../tools/student-tools.ts";
import type { AcademicData } from "../types/academic.ts";
import { findStudent } from "../data/loader.ts";

// System prompt for student-focused academic advisor
const STUDENT_SYSTEM_PROMPT =
  `You are an Academic Advisor AI assistant helping a student at Tech University.

Your role is to provide personalized academic guidance by:
1. Assessing the student's current academic standing and performance
2. Identifying courses where they may be at risk of failing
3. Tracking their progress toward graduation requirements
4. Providing actionable improvement recommendations

IMPORTANT GUIDELINES:
- Always be supportive and constructive, even when discussing challenges
- When a student is struggling, focus on concrete steps they can take to improve
- Use the available tools to gather accurate, real-time data before providing advice
- Never make assumptions about grades or status - always check using tools
- Provide specific, actionable recommendations based on the data

RESPONSE FORMAT:
- Start with a brief summary of the student's situation
- Highlight any immediate concerns or achievements
- Provide 2-4 specific, actionable recommendations
- Keep responses focused and avoid overwhelming the student

When the student asks about their academic situation, use the tools in this order:
1. get_student_profile - to understand their overall standing
2. get_current_courses - to see this semester's performance
3. get_at_risk_courses - if there are performance concerns
4. get_graduation_progress - for graduation-related questions
5. get_recommendations - to provide improvement suggestions

Remember: You are speaking directly to the student about THEIR academic journey. Use "you" and "your" when addressing them.`;

/**
 * Create a student-mode academic advisor agent
 * This agent is personalized for a specific student
 */
export function createStudentAgent(
  data: AcademicData,
  studentId: string,
  config: AgentConfig = {},
) {
  // Validate student exists
  const student = findStudent(data, studentId);
  if (!student) {
    throw new Error(`Student not found: ${studentId}`);
  }

  // Create tools bound to this specific student
  const tools = createStudentTools(data, studentId);

  // Create and return the agent
  return createAgent(tools, STUDENT_SYSTEM_PROMPT, config);
}

/**
 * Get student info for display purposes
 */
export function getStudentInfo(data: AcademicData, studentId: string) {
  const student = findStudent(data, studentId);
  if (!student) return null;

  const department = data.departments.find(
    (d) => d.id === student.department_id,
  );

  return {
    id: student.id,
    name: student.name,
    department: department?.name ?? student.department_id,
    semester: student.current_semester,
    gpa: student.gpa,
    status: student.status,
  };
}
