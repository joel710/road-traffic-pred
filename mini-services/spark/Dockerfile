FROM bitnami/spark:latest

USER root
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir \
    torch \
    numpy \
    pandas \
    redis \
    psycopg2-binary

# Set environment variables for Spark to find the Python interpreter
ENV PYSPARK_PYTHON=python3
ENV PYSPARK_DRIVER_PYTHON=python3

WORKDIR /app
COPY spark_processor.py .

# Models will be mounted via volume or copied
# COPY models/ /app/models/
