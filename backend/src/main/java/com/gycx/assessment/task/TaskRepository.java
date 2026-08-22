package com.gycx.assessment.task;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
class TaskRepository {
  private final JdbcClient jdbc;

  TaskRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

  List<Task> findAll() {
    return jdbc.sql("select id, title, description, status, created_at from tasks order by id desc")
        .query(Task.class).list();
  }

  Task create(CreateTaskRequest request) {
    return jdbc.sql("insert into tasks(title, description, status) values (:title, :description, 'TODO') returning id, title, description, status, created_at")
        .param("title", request.title().trim())
        .param("description", request.description() == null ? "" : request.description().trim())
        .query(Task.class).single();
  }
}

