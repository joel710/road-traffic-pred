FROM bitnami/spark:latest

USER root
RUN apt-get update && apt-get install -y \
    gcc \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir \
    torch \
    numpy \
    pandas \
    kafka-python

ENV PYSPARK_PYTHON=python3
ENV PYSPARK_DRIVER_PYTHON=python3

WORKDIR /app
COPY spark_processor.py .
