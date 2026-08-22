package com.gycx.assessment.task;

import java.time.OffsetDateTime;

public record Task(long id, String title, String description, TaskStatus status, OffsetDateTime createdAt) {}

