package com.gycx.assessment.task;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateTaskRequest(
    @NotBlank @Size(max = 120) String title,
    @Size(max = 1000) String description) {}

