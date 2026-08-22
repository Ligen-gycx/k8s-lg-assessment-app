package com.gycx.assessment.task;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class RuntimeController {
  private final String podName;
  private final String nodeName;
  private final String podIp;

  RuntimeController(
      @Value("${POD_NAME:unknown}") String podName,
      @Value("${NODE_NAME:unknown}") String nodeName,
      @Value("${POD_IP:unknown}") String podIp) {
    this.podName = podName;
    this.nodeName = nodeName;
    this.podIp = podIp;
  }

  @GetMapping("/api/runtime")
  RuntimeInfo runtime() {
    return new RuntimeInfo(podName, nodeName, podIp);
  }

  record RuntimeInfo(String podName, String nodeName, String podIp) {}
}
