import { z } from "zod";

export const meetingStatusEnum = z.enum(["SCHEDULED", "HELD", "CANCELLED", "POSTPONED"]);

export const meetingMinuteSchema = z.object({
  meetingDate: z.string().min(1, "Meeting date is required"),
  status: meetingStatusEnum.default("SCHEDULED"),
  notes: z.string().optional().nullable(),
  projectId: z.string().min(1, "Project is required"),
});

export type MeetingMinuteInput = z.infer<typeof meetingMinuteSchema>;
