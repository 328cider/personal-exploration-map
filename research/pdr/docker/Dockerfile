FROM python:3.12.9-slim@sha256:48a11b7ba705fd53bf15248d1f94d36c39549903c5d59edcfa2f3f84126e7b44

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /workspace

COPY research/pdr/docker/requirements.txt /tmp/pdr-requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/pdr-requirements.txt

CMD ["python", "-m", "unittest", "discover", "-s", "research/pdr/tests", "-v"]
