FROM bitnamilegacy/spark:latest

USER root
RUN apt-get update && apt-get install -y \
    gcc python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Use requirements.txt for reproducible dependency versions
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

ENV PYSPARK_PYTHON=python3
ENV PYSPARK_DRIVER_PYTHON=python3

WORKDIR /app
COPY spark_processor.py .

CMD ["spark-submit", "--master", "local[*]", \
     "--packages", "org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0", \
     "spark_processor.py"]
