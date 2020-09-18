import toposort from "toposort";

import { SubmissionTask, ProblemSample, SubmissionStatus } from ".";

interface TestcaseConfigCommon {
  timeLimit?: number;
  memoryLimit?: number;
  inputFile?: string;
  outputFile?: string;
  points?: number;
}

interface JudgeInfoCommon<TestcaseConfig extends TestcaseConfigCommon> {
  runSamples?: boolean;
  timeLimit?: number;
  memoryLimit?: number;
  subtasks: {
    timeLimit?: number;
    memoryLimit?: number;
    testcases: TestcaseConfig[];
    scoringType: "Sum" | "GroupMin" | "GroupMul";
    points?: number;
    dependencies?: number[];
  }[];
}

interface SubmissionContentCommon {
  skipSamples?: boolean;
}

interface TestcaseResultCommon {
  status: string;
  score: number;
}

function getSubtaskOrder(judgeInfo: JudgeInfoCommon<TestcaseConfigCommon>) {
  return toposort.array(
    [...judgeInfo.subtasks.keys()],
    judgeInfo.subtasks.reduce<[number, number][]>(
      (edges, subtask, i) => edges.concat((subtask.dependencies || []).map(dependency => [dependency, i])),
      []
    )
  );
}

export async function runCommonTask<
  JudgeInfo extends JudgeInfoCommon<TestcaseConfig>,
  TestcaseConfig extends TestcaseConfigCommon,
  SubmissionContent extends SubmissionContentCommon,
  TestcaseResult extends TestcaseResultCommon,
  ExtraParameters
>({
  task,
  extraParameters,
  onTestcase
}: {
  task: SubmissionTask<JudgeInfo, SubmissionContent, TestcaseResult>;
  extraParameters: ExtraParameters;
  onTestcase: (
    task: SubmissionTask<JudgeInfo, SubmissionContent, TestcaseResult>,
    judgeInfo: JudgeInfo,
    sampleId: number,
    sample: ProblemSample,
    subtaskIndex: number,
    testcaseIndex: number,
    testcase: TestcaseConfig,
    extraParameters: ExtraParameters
  ) => Promise<TestcaseResult>;
}) {
  const { judgeInfo } = task.extraInfo;

  const { samples } = task.extraInfo;

  const sumSpecfiedPercentagePointsForSubtasks = judgeInfo.subtasks
    .map(testcase => testcase.points)
    .filter(x => x != null)
    .reduce((s, x) => s + x, 0);
  const countUnspecfiedPercentagePointsForSubtasks = judgeInfo.subtasks.filter(testcase => testcase.points == null)
    .length;
  const defaultPercentagePointsForSubtasks =
    (100 - sumSpecfiedPercentagePointsForSubtasks) / countUnspecfiedPercentagePointsForSubtasks;

  const subtaskFullScores = judgeInfo.subtasks.map(subtask =>
    subtask.points != null ? subtask.points : defaultPercentagePointsForSubtasks
  );

  const runSamples = !!(
    judgeInfo.runSamples &&
    task.extraInfo.samples &&
    !task.extraInfo.submissionContent.skipSamples
  );
  task.reportProgress.startedRunning(runSamples && samples.length, subtaskFullScores);

  let firstNonAcceptedStatus: string = null;

  // Run samples first
  let samplesFailed = false;
  if (runSamples) {
    for (const i of samples.keys()) {
      if (samplesFailed) {
        task.reportProgress.sampleTestcaseFinished(i, samples[i], null);
        continue;
      }

      const result = await onTestcase(task, judgeInfo, i, samples[i], null, null, null, extraParameters);

      if (result.status !== "Accepted") {
        samplesFailed = true;
        firstNonAcceptedStatus = result.status;
      }
    }
  }

  const subtaskOrder = getSubtaskOrder(judgeInfo);
  const subtaskScores: number[] = new Array(subtaskOrder.length);
  let totalScore = 0;
  for (const subtaskIndex of subtaskOrder) {
    const subtask = judgeInfo.subtasks[subtaskIndex];

    // If samples failed, skip all subtasks
    // If any of a subtask's dependencies failed, skip it
    if (
      samplesFailed ||
      (Array.isArray(subtask.dependencies) && subtask.dependencies.some(i => Math.round(subtaskScores[i]) === 0))
    ) {
      // Skip
      task.reportProgress.subtaskScoreUpdated(subtaskIndex, 0);
      for (const i of subtask.testcases.keys()) {
        task.reportProgress.testcaseFinished(subtaskIndex, i, null);
      }
      continue;
    }

    const sumSpecfiedPercentagePointsForTestcases = subtask.testcases
      .map(testcase => testcase.points)
      .filter(x => x != null)
      .reduce((s, x) => s + x, 0);
    const countUnspecfiedPercentagePointsForTestcases = subtask.testcases.filter(testcase => testcase.points == null)
      .length;
    const defaultPercentagePointsForTestcases =
      (100 - sumSpecfiedPercentagePointsForTestcases) / countUnspecfiedPercentagePointsForTestcases;

    const normalizedTestcases = subtask.testcases.map(testcase => ({
      ...testcase,
      points: testcase.points == null ? defaultPercentagePointsForTestcases : testcase.points,
      timeLimit: testcase.timeLimit || subtask.timeLimit || judgeInfo.timeLimit,
      memoryLimit: testcase.memoryLimit || subtask.memoryLimit || judgeInfo.memoryLimit
    }));

    let subtaskScore = 0;
    if (subtask.scoringType !== "Sum") subtaskScore = 100;

    let results: TestcaseResult[];
    if (subtask.scoringType === "Sum") {
      results = await Promise.all(
        normalizedTestcases.map(async (testcase, i) => {
          const result = await onTestcase(task, judgeInfo, null, null, subtaskIndex, i, testcase, extraParameters);
          subtaskScore += (result.score * normalizedTestcases[i].points) / 100;
          task.reportProgress.subtaskScoreUpdated(subtaskIndex, subtaskScore);
          return result;
        })
      );
    } else {
      results = [];
      for (const i of normalizedTestcases.keys()) {
        const testcase = normalizedTestcases[i];

        if (Math.round(subtaskScore) === 0) {
          task.reportProgress.testcaseFinished(subtaskIndex, i, null);
        } else {
          const result = await onTestcase(task, judgeInfo, null, null, subtaskIndex, i, testcase, extraParameters);
          if (subtask.scoringType === "GroupMin") subtaskScore = Math.min(subtaskScore, result.score);
          else subtaskScore = (subtaskScore * result.score) / 100;
          task.reportProgress.subtaskScoreUpdated(subtaskIndex, subtaskScore);
          results.push(result);
        }
      }
    }

    if (firstNonAcceptedStatus === null) {
      for (const result of results) {
        if (result.status !== "Accepted") {
          firstNonAcceptedStatus = result.status;
          break;
        }
      }
    }

    subtaskScores[subtaskIndex] = subtaskScore;
    totalScore += (subtaskScore * subtaskFullScores[subtaskIndex]) / 100;
  }

  const roundedScore = totalScore > 100 ? 100 : Math.round(totalScore);
  if (firstNonAcceptedStatus === null && roundedScore !== 100) {
    // This shouldn't happen
    throw new Error("Couldn't determine submission result status");
  } else if (firstNonAcceptedStatus === null) {
    task.reportProgress.finished(SubmissionStatus.Accepted, roundedScore);
  } else {
    task.reportProgress.finished((firstNonAcceptedStatus as unknown) as SubmissionStatus, roundedScore);
  }
}

interface JudgeInfoWithSubtasks {
  subtasks: {
    testcases: {
      inputFile?: string;
      outputFile?: string;
    }[];
  }[];
}

/* eslint-disable no-throw-literal */
export function validateJudgeInfoSubtasks(
  judgeInfo: JudgeInfoWithSubtasks,
  testData: Record<string, string>,
  enableInputFile: boolean | "optional" = true,
  enableOutputFile: boolean | "optional" = true
) {
  if (
    judgeInfo.subtasks.length === 0 ||
    (judgeInfo.subtasks.length === 1 && judgeInfo.subtasks[0].testcases.length === 0)
  )
    throw "No testcases.";
  judgeInfo.subtasks.forEach((subtask, i) => {
    if (subtask.testcases.length === 0) throw `Subtask ${i + 1} has no testcases.`;

    subtask.testcases.forEach(({ inputFile, outputFile }, j) => {
      if (enableInputFile && !(!inputFile && enableInputFile === "optional") && !(inputFile in testData))
        throw `Input file ${inputFile} referenced by subtask ${i + 1}'s testcase ${j + 1} doesn't exist.`;
      if (enableOutputFile && !(!outputFile && enableOutputFile === "optional") && !(outputFile in testData))
        throw `Output file ${outputFile} referenced by subtask ${i + 1}'s testcase ${j + 1} doesn't exist.`;
    });
  });
}
/* eslint-enable no-throw-literal */

interface JudgeInfoWithExtraSourceFiles {
  extraSourceFiles?: Partial<Record<string, Record<string, string>>>;
}

/* eslint-disable no-throw-literal */
export function validateJudgeInfoExtraSourceFiles(
  judgeInfo: JudgeInfoWithExtraSourceFiles,
  testData: Record<string, string>
) {
  if (!judgeInfo.extraSourceFiles) return;

  Object.entries(judgeInfo.extraSourceFiles).forEach(([language, fileMap]) => {
    Object.entries(fileMap).forEach(([dst, src]) => {
      if (!(src in testData))
        throw `Extra source file ${src} (mapped to ${dst}, for language ${language}) doesn't exist.`;
    });
  });
}
/* eslint-enable no-throw-literal */

export function getExtraSourceFiles(
  judgeInfo: JudgeInfoWithExtraSourceFiles,
  testData: Record<string, string>,
  language: string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries((judgeInfo.extraSourceFiles || {})[language] || {}).map(([dst, src]) => [dst, testData[src]])
  );
}
