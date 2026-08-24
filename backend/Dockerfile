FROM docker.m.daocloud.io/library/maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY .mvn/settings.xml /root/.m2/settings.xml
COPY pom.xml .
RUN mvn -q -DskipTests -Dmaven.wagon.http.connectionTimeout=10000 -Dmaven.wagon.http.readTimeout=60000 dependency:go-offline
COPY src src
RUN mvn -q -DskipTests -Dmaven.wagon.http.connectionTimeout=10000 -Dmaven.wagon.http.readTimeout=60000 package

FROM docker.m.daocloud.io/library/eclipse-temurin:21-jre-jammy
RUN useradd --system --uid 10001 appuser
WORKDIR /app
COPY --from=build /workspace/target/assessment-api-0.1.0.jar app.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
