import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import type { AcademicData, Course } from "../types/academic.ts";

// Singleton vector store instance
let vectorStore: MemoryVectorStore | null = null;
let isInitialized = false;

/**
 * Initialize the course vector store with embeddings
 * Creates semantic search capability over course descriptions
 */
export async function initializeCourseVectorStore(
  data: AcademicData
): Promise<MemoryVectorStore> {
  if (vectorStore && isInitialized) {
    return vectorStore;
  }

  console.log("Initializing course vector store...");

  // Create documents from course data
  const documents = data.courses.map((course) => {
    // Create rich content for embedding
    const content = buildCourseDocument(course, data);

    return new Document({
      pageContent: content,
      metadata: {
        courseId: course.id,
        courseCode: course.code,
        courseName: course.name,
        departmentId: course.department_id,
        credits: course.credits,
        type: course.type,
        semester: course.semester,
        prerequisites: course.prerequisites,
      },
    });
  });

  // Create embeddings instance
  const embeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-small", // Cost-effective embedding model
  });

  // Build vector store
  vectorStore = await MemoryVectorStore.fromDocuments(documents, embeddings);
  isInitialized = true;

  console.log(`Vector store initialized with ${documents.length} courses`);
  return vectorStore;
}

/**
 * Build a rich document content for a course
 * Includes description, prerequisites, and context
 */
function buildCourseDocument(course: Course, data: AcademicData): string {
  const prereqNames = course.prerequisites
    .map((prereqId) => {
      const prereqCourse = data.courses.find((c) => c.id === prereqId);
      return prereqCourse ? prereqCourse.name : prereqId;
    })
    .join(", ");

  const department = data.departments.find(
    (d) => d.id === course.department_id
  );

  return `
Course: ${course.name} (${course.code})
Department: ${department?.name ?? course.department_id}
Credits: ${course.credits}
Type: ${course.type}
Recommended Semester: ${course.semester}
Prerequisites: ${prereqNames || "None"}
Description: ${course.description}
  `.trim();
}

/**
 * Search for courses semantically based on a query
 */
export async function searchCourses(
  query: string,
  data: AcademicData,
  topK: number = 3
): Promise<{
  courses: {
    courseId: string;
    courseCode: string;
    courseName: string;
    credits: number;
    type: string;
    relevanceScore: number;
    description: string;
  }[];
}> {
  // Ensure vector store is initialized
  const store = await initializeCourseVectorStore(data);

  // Perform similarity search
  const results = await store.similaritySearchWithScore(query, topK);

  return {
    courses: results.map(([doc, score]) => ({
      courseId: doc.metadata.courseId as string,
      courseCode: doc.metadata.courseCode as string,
      courseName: doc.metadata.courseName as string,
      credits: doc.metadata.credits as number,
      type: doc.metadata.type as string,
      relevanceScore: 1 - score, // Convert distance to similarity (higher = better)
      description: doc.pageContent,
    })),
  };
}

/**
 * Find courses related to a specific topic or skill
 */
export async function findCoursesByTopic(
  topic: string,
  data: AcademicData,
  options: {
    maxResults?: number;
    courseType?: "required" | "elective" | "all";
    departmentId?: string;
  } = {}
): Promise<Course[]> {
  const { maxResults = 5, courseType = "all", departmentId } = options;

  const store = await initializeCourseVectorStore(data);
  const results = await store.similaritySearch(topic, maxResults * 2);

  // Filter and map back to Course objects
  let courses = results
    .map((doc) => data.courses.find((c) => c.id === doc.metadata.courseId))
    .filter((c): c is Course => c !== undefined);

  // Apply filters
  if (courseType !== "all") {
    courses = courses.filter((c) => c.type === courseType);
  }
  if (departmentId) {
    courses = courses.filter((c) => c.department_id === departmentId);
  }

  return courses.slice(0, maxResults);
}

/**
 * Get course recommendations based on student's interests and progress
 */
export async function getPersonalizedRecommendations(
  query: string,
  studentId: string,
  data: AcademicData,
  maxResults: number = 3
): Promise<{
  recommended: Course[];
  reasoning: string[];
}> {
  const student = data.students.find((s) => s.id === studentId);
  if (!student) {
    return { recommended: [], reasoning: ["Student not found"] };
  }

  // Get passed courses
  const passedCourseIds = new Set(
    student.enrollments
      .filter((e) => e.status === "passed")
      .map((e) => e.course_id)
  );

  const currentlyEnrolledIds = new Set(
    student.enrollments
      .filter((e) => e.status === "in_progress")
      .map((e) => e.course_id)
  );

  // Search for relevant courses
  const searchResults = await searchCourses(query, data, maxResults * 3);

  const reasoning: string[] = [];
  const recommended: Course[] = [];

  for (const result of searchResults.courses) {
    const course = data.courses.find((c) => c.id === result.courseId);
    if (!course) continue;

    // Skip if already completed or enrolled
    if (passedCourseIds.has(course.id)) {
      continue;
    }
    if (currentlyEnrolledIds.has(course.id)) {
      continue;
    }

    // Check prerequisites
    const prereqsMet = course.prerequisites.every((prereq) =>
      passedCourseIds.has(prereq)
    );

    if (!prereqsMet) {
      const missingPrereqs = course.prerequisites.filter(
        (p) => !passedCourseIds.has(p)
      );
      reasoning.push(
        `${course.code} requires: ${missingPrereqs.join(", ")}`
      );
      continue;
    }

    recommended.push(course);
    reasoning.push(
      `${course.code} matches your interest and you have completed prerequisites`
    );

    if (recommended.length >= maxResults) break;
  }

  return { recommended, reasoning };
}

/**
 * Clear the vector store (for testing or refresh)
 */
export function clearVectorStore(): void {
  vectorStore = null;
  isInitialized = false;
}
