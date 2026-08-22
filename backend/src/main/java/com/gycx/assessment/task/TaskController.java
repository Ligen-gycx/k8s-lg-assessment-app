package com.gycx.assessment.task;

import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tasks")
class TaskController {
  private final TaskRepository repository;

  TaskController(TaskRepository repository) { this.repository = repository; }

  @GetMapping
  List<Task> list() { return repository.findAll(); }

  @PostMapping
  ResponseEntity<Task> create(@Valid @RequestBody CreateTaskRequest request) {
    Task task = repository.create(request);
    return ResponseEntity.created(URI.create("/api/tasks/" + task.id())).body(task);
  }
}

