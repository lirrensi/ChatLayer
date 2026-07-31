// Test script to verify Prisma client works
import 'dotenv/config'
import { PrismaClient } from '../src/generated/client.ts'

// Create a simple client instance to test
const prisma = new PrismaClient()

console.log('Prisma client created successfully')
console.log('Prisma client type:', typeof prisma)

// Try to connect and disconnect
async function testConnection() {
    try {
        console.log('Testing connection...')
        await prisma.$connect()
        console.log('Connected successfully')
        await prisma.$disconnect()
        console.log('Disconnected successfully')
    } catch (error) {
        console.error('Connection test failed:', error)
    }
}

testConnection()