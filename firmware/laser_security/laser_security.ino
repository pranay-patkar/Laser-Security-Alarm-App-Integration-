 int LED = 13;
int LaserSensor = 2;
int SensorReading = HIGH;  // HIGH MEANS NO OBSTACLE
int Laser = 12;
int alarmSpeaker = 7;
 
void setup() {
  pinMode(LED, OUTPUT);
  pinMode(Laser, OUTPUT);
  pinMode(alarmSpeaker, OUTPUT);
  pinMode(LaserSensor, INPUT);
}
 
void alarmTone() {
  tone(7,  NOTE_F6, 400);
  delay(100);
  tone(7,  NOTE_G4, 400);
  delay(100);
}
 
void alarm() {
  delay(3000); //Time before alarm starts
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  alarmTone();
  }
 
void loop() {
  digitalWrite(Laser, HIGH);
  delay(200);
  SensorReading = digitalRead(LaserSensor);
  if (SensorReading == LOW)
  {
    digitalWrite(LED, HIGH);
    alarm();
  }
 
  else
  {
    digitalWrite(LED, LOW);
  }
}
